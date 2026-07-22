use anyhow::Result;
use bollard::{
    container::LogOutput,
    exec::{CreateExecOptions, StartExecResults},
    Docker,
};
use futures::StreamExt;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

use super::parser::{BeetsFrame, BeetsParser};

pub enum BeetsAction {
    Apply,
    Skip,
    UseAsIs,
    MoreCandidates,
    Select(usize),
    EnterId(String),
    Abort,
}

impl BeetsAction {
    fn to_input(&self) -> String {
        match self {
            Self::Apply => "A\n".to_string(),
            Self::Skip => "S\n".to_string(),
            Self::UseAsIs => "U\n".to_string(),
            Self::MoreCandidates => "M\n".to_string(),
            Self::Select(n) => format!("{n}\n"),
            Self::EnterId(id) => format!("{id}\n"),
            Self::Abort => "B\n".to_string(),
        }
    }
}

pub async fn run_import(
    music_path: String,
    force: bool,
    frame_tx: mpsc::UnboundedSender<BeetsFrame>,
    mut action_rx: mpsc::UnboundedReceiver<BeetsAction>,
) -> Result<()> {
    let docker = Docker::connect_with_unix_defaults()
        .map_err(|e| anyhow::anyhow!("Cannot connect to Docker socket (/var/run/docker.sock). Is it mounted into the container? Error: {e}"))?;

    let mut cmd = vec!["beet", "import"];
    if force { cmd.push("-I"); }
    cmd.push(music_path.as_str());

    let exec = docker.create_exec(
        "beets",
        CreateExecOptions {
            attach_stdin: Some(true),
            attach_stdout: Some(true),
            attach_stderr: Some(true),
            tty: Some(false),
            env: Some(vec!["TERM=dumb", "NO_COLOR=1", "PYTHONUNBUFFERED=1"]),
            cmd: Some(cmd),
            ..Default::default()
        },
    )
    .await?;

    let StartExecResults::Attached { mut input, mut output } =
        docker.start_exec(&exec.id, None::<bollard::exec::StartExecOptions>).await?
    else {
        anyhow::bail!("Exec was not attached");
    };

    // Forward user actions → beets stdin
    tokio::spawn(async move {
        while let Some(action) = action_rx.recv().await {
            let _ = input.write_all(action.to_input().as_bytes()).await;
        }
    });

    let mut parser = BeetsParser::new();
    let mut line_buf = String::new();

    while let Some(item) = output.next().await {
        let bytes = match item? {
            LogOutput::StdOut { message: b }
            | LogOutput::StdErr { message: b }
            | LogOutput::Console { message: b } => b,
            _ => continue,
        };

        line_buf.push_str(&String::from_utf8_lossy(&bytes));

        // Drain complete lines; also flush if buffer ends with a prompt suffix
        loop {
            if let Some(nl) = line_buf.find('\n') {
                let line = line_buf[..nl].to_string();
                line_buf = line_buf[nl + 1..].to_string();
                if let Some(frame) = parser.feed(&line) {
                    frame_tx.send(frame).ok();
                }
            } else {
                // Flush if the buffer contains a hanging prompt (no trailing newline).
                // Use contains() rather than ends_with() — beets may append extra whitespace
                // or the prompt chars may arrive split across Docker output chunks.
                let trimmed = line_buf.trim_end();
                if trimmed.contains("aBort?") || trimmed.contains("aBort)") {
                    let line = trimmed.to_string();
                    line_buf.clear();
                    if let Some(frame) = parser.feed(&line) {
                        frame_tx.send(frame).ok();
                    }
                }
                break;
            }
        }
    }

    frame_tx.send(BeetsFrame::Done).ok();
    Ok(())
}
