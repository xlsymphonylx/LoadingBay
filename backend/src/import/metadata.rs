use std::path::{Path, PathBuf};

const ALBUM_ARTIST_TAGS: &[&str] = &["ALBUMARTIST", "ALBUM ARTIST", "ALBUM_ARTIST"];

pub struct AlbumArtistNormalization {
    pub updated: usize,
    pub warnings: Vec<String>,
    pub album_artist: String,
}

fn collect_flac_files(dir: &Path, out: &mut Vec<PathBuf>) -> anyhow::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_flac_files(&path, out)?;
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("flac"))
        {
            out.push(path);
        }
    }
    Ok(())
}

fn tag_value(line: &str) -> Option<String> {
    let (_, value) = line.split_once('=')?;
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn trim_artist_candidate(value: &str) -> String {
    value
        .trim()
        .trim_end_matches(|c: char| {
            c.is_whitespace() || matches!(c, '(' | '[' | '{' | '-' | ',' | ';')
        })
        .trim()
        .to_string()
}

fn strip_feature_suffix(value: &str) -> String {
    let lower = value.to_lowercase();
    let markers = [
        " feat. ",
        " feat ",
        " ft. ",
        " ft ",
        " featuring ",
        " feat.",
        " ft.",
        " (feat.",
        " (feat ",
        " (ft.",
        " (ft ",
        " [feat.",
        " [feat ",
        " [ft.",
        " [ft ",
    ];

    markers
        .iter()
        .filter_map(|marker| lower.find(marker))
        .min()
        .map(|index| trim_artist_candidate(&value[..index]))
        .filter(|candidate| !candidate.is_empty())
        .unwrap_or_else(|| value.trim().to_string())
}

fn most_common(values: impl IntoIterator<Item = String>) -> Option<(String, usize)> {
    let mut counts = std::collections::HashMap::<String, usize>::new();
    for value in values {
        let value = value.trim().to_string();
        if !value.is_empty() {
            *counts.entry(value).or_insert(0) += 1;
        }
    }
    counts.into_iter().max_by_key(|(_, count)| *count)
}

pub(crate) fn infer_common_album_artist(values: &[String], fallback_artist: &str) -> String {
    if values.is_empty() {
        return fallback_artist.to_string();
    }

    let normalized: Vec<String> = values.iter().map(|value| strip_feature_suffix(value)).collect();
    if let Some((candidate, count)) = most_common(normalized) {
        if count >= 2 || values.len() == 1 {
            return candidate;
        }
    }

    let first_segments = values.iter().filter_map(|value| {
        let segment = value.split([',', ';']).next().map(trim_artist_candidate)?;
        (!segment.is_empty()).then_some(segment)
    });
    if let Some((candidate, count)) = most_common(first_segments) {
        if count >= 2 {
            return candidate;
        }
    }

    fallback_artist.to_string()
}

#[cfg(test)]
mod tests {
    use super::infer_common_album_artist;

    fn values(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn strips_common_feat_suffixes() {
        let artist = infer_common_album_artist(
            &values(&[
                "Main Artist feat. Guest A",
                "Main Artist ft. Guest B",
                "Main Artist featuring Guest C",
            ]),
            "Fallback",
        );
        assert_eq!(artist, "Main Artist");
    }

    #[test]
    fn uses_common_first_segment_when_suffixes_do_not_help() {
        let artist = infer_common_album_artist(
            &values(&[
                "Main Artist, Guest A",
                "Main Artist; Guest B",
                "Other Artist",
            ]),
            "Fallback",
        );
        assert_eq!(artist, "Main Artist");
    }

    #[test]
    fn falls_back_when_no_common_artist_exists() {
        let artist = infer_common_album_artist(
            &values(&["Artist A", "Artist B", "Artist C"]),
            "Fallback Artist",
        );
        assert_eq!(artist, "Fallback Artist");
    }

    #[test]
    fn keeps_single_album_artist_after_cleanup() {
        let artist = infer_common_album_artist(&values(&["Main Artist (feat. Guest)"]), "Fallback");
        assert_eq!(artist, "Main Artist");
    }
}

async fn read_album_artist_values(path: &Path) -> anyhow::Result<Vec<String>> {
    let mut values = Vec::new();

    for tag in ALBUM_ARTIST_TAGS {
        let output = tokio::process::Command::new("metaflac")
            .env("LANG", "C.UTF-8")
            .env("LC_ALL", "C.UTF-8")
            .arg(format!("--show-tag={tag}"))
            .arg(path)
            .output()
            .await?;

        if output.status.success() {
            values.extend(
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .filter_map(tag_value),
            );
        }
    }

    Ok(values)
}

pub async fn normalize_album_artist(
    album_dir: &Path,
    fallback_artist: &str,
) -> anyhow::Result<AlbumArtistNormalization> {
    let mut flacs = Vec::new();
    collect_flac_files(album_dir, &mut flacs)?;

    let mut existing_values = Vec::new();
    let mut warnings = Vec::new();
    for path in &flacs {
        match read_album_artist_values(path).await {
            Ok(values) => existing_values.extend(values),
            Err(e) => warnings.push(format!("{}: read album artist tags: {e}", path.display())),
        }
    }

    let album_artist = infer_common_album_artist(&existing_values, fallback_artist);
    let mut updated = 0usize;

    for path in flacs {
        let output = tokio::process::Command::new("metaflac")
            .env("LANG", "C.UTF-8")
            .env("LC_ALL", "C.UTF-8")
            .arg("--remove-tag=ALBUMARTIST")
            .arg("--remove-tag=ALBUM ARTIST")
            .arg("--remove-tag=ALBUM_ARTIST")
            .arg(format!("--set-tag=ALBUMARTIST={album_artist}"))
            .arg(&path)
            .output()
            .await;

        match output {
            Ok(out) if out.status.success() => updated += 1,
            Ok(out) => warnings.push(format!(
                "{}: {}",
                path.display(),
                String::from_utf8_lossy(&out.stderr).trim()
            )),
            Err(e) => warnings.push(format!("{}: {e}", path.display())),
        }
    }

    Ok(AlbumArtistNormalization {
        updated,
        warnings,
        album_artist,
    })
}
