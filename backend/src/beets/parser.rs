use serde::Serialize;

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BeetsFrame {
    AlbumPrompt(AlbumPrompt),
    Log { text: String },
    Done,
    Error { message: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct AlbumPrompt {
    pub path: String,
    pub items: u32,
    pub prompt_type: PromptType,
    pub default_candidate: Option<usize>,
    pub match_info: Option<MatchInfo>,
    pub candidates: Vec<Candidate>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptType {
    ApplySkip,
    CandidateSelect,
}

#[derive(Debug, Clone, Serialize)]
pub struct MatchInfo {
    pub score: f32,
    pub display: String,
    pub source: String,
    pub format: String,
    pub year: Option<u32>,
    pub country: Option<String>,
    pub label: Option<String>,
    pub url: Option<String>,
    pub diff_summary: String,
    pub diff_artist: Option<[String; 2]>,
    pub diff_album: Option<[String; 2]>,
    pub diff_tracks: Vec<String>,
    pub missing_tracks: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Candidate {
    pub index: usize,
    pub score: f32,
    pub display: String,
    pub diff_summary: String,
    pub source: String,
    pub format: String,
    pub year: Option<u32>,
    pub label: Option<String>,
    pub catalog: Option<String>,
    pub media: Option<String>,
}

// ── Parser ─────────────────────────────────────────────────────────────────

/// Strip ANSI escape sequences from a string
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            for ec in chars.by_ref() {
                if ec.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn parse_score(s: &str) -> Option<f32> {
    let start = s.find('(')? + 1;
    let end = s.find('%')?;
    s[start..end].trim().parse().ok()
}

pub struct BeetsParser {
    current_path: Option<String>,
    current_items: u32,
    block: Vec<String>,
}

impl BeetsParser {
    pub fn new() -> Self {
        Self { current_path: None, current_items: 0, block: Vec::new() }
    }

    /// Feed one line of beets output. Returns a frame when a complete prompt block is ready.
    pub fn feed(&mut self, raw: &str) -> Option<BeetsFrame> {
        let line = strip_ansi(raw).trim_end_matches('\r').to_string();
        let trimmed = line.trim();

        // New album header: "/music/Artist/Album (N items)"
        if trimmed.starts_with("/music/") && trimmed.contains(" (") && trimmed.contains(" items)") {
            let paren = trimmed.rfind('(')?;
            let path = trimmed[..paren].trim().to_string();
            let items: u32 = trimmed[paren + 1..]
                .split_whitespace()
                .next()
                .and_then(|n| n.parse().ok())
                .unwrap_or(0);
            self.current_path = Some(path);
            self.current_items = items;
            self.block.clear();
            return Some(BeetsFrame::Log { text: line });
        }

        // Detect end of prompt: apply/skip ends with "aBort?", candidate select ends with "aBort)"
        let contains_abort = trimmed.contains("aBort?") || trimmed.contains("aBort)");
        if contains_abort {
            self.block.push(line);
            if let Some(path) = self.current_path.as_deref() {
                let frame = parse_block(path, self.current_items, &self.block);
                self.block.clear();
                // Retain current_path: after a candidate-select, beets shows the apply/skip
                // prompt for the chosen candidate WITHOUT reprinting the /music/... header.
                // Clearing path here would orphan that follow-up block.
                return Some(BeetsFrame::AlbumPrompt(frame));
            }
            return None;
        }

        if self.current_path.is_some() {
            self.block.push(line);
            return None;
        }

        // Any other line outside a prompt block → surface as a log message
        if !trimmed.is_empty() {
            return Some(BeetsFrame::Log { text: line });
        }

        None
    }
}

fn parse_block(path: &str, items: u32, lines: &[String]) -> AlbumPrompt {
    let mut prompt_type = PromptType::ApplySkip;
    let mut default_candidate = None;

    // match fields
    let mut match_score: Option<f32> = None;
    let mut match_display = String::new();
    let mut match_diff_summary = String::new();
    let mut source_line = String::new();
    let mut match_url: Option<String> = None;
    let mut diff_artist: Option<[String; 2]> = None;
    let mut diff_album: Option<[String; 2]> = None;
    let mut diff_tracks: Vec<String> = Vec::new();
    let mut missing_tracks: Vec<String> = Vec::new();

    // candidate fields
    let mut in_candidates = false;
    let mut candidates: Vec<Candidate> = Vec::new();
    let mut cur_cand: Option<Candidate> = None;
    let mut in_missing = false;

    for line in lines {
        let t = line.trim();
        if t.is_empty() { continue; }

        // Prompt line — apply/skip ends with "aBort?", candidate select ends with "aBort)"
        if t.starts_with('➜') || t.starts_with("->") || t.contains("aBort?") || t.contains("aBort)") {
            // Candidate select prompt contains "selection" or a digit range like "1-N"
            if t.contains("selection") || (t.contains("aBort)") && !t.contains("aBort?")) {
                prompt_type = PromptType::CandidateSelect;
                if let Some(pos) = t.find("default ") {
                    let rest = &t[pos + 8..];
                    let num: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                    default_candidate = num.parse().ok();
                }
            }
            continue;
        }

        // Candidates section header
        if t == "Candidates:" {
            in_candidates = true;
            continue;
        }

        if in_candidates {
            feed_candidate_line(t, &mut cur_cand, &mut candidates);
            continue;
        }

        // Missing tracks section
        if t.starts_with("Missing tracks") {
            in_missing = true;
            continue;
        }
        if in_missing {
            if t.starts_with('!') {
                missing_tracks.push(t.trim_start_matches('!').trim().to_string());
            } else {
                in_missing = false;
            }
            continue;
        }

        // Match score line
        if t.starts_with("Match (") {
            if let Some(s) = parse_score(t) { match_score = Some(s); }
            continue;
        }

        // URL
        if t.starts_with("https://") {
            match_url = Some(t.to_string());
            continue;
        }

        // Artist/Album field diffs always contain " -> " — check these before the generic ≠ handler
        if t.starts_with("≠ Artist:") {
            let rest = t.trim_start_matches("≠ Artist:").trim();
            if let Some((f, to)) = rest.split_once(" -> ") {
                diff_artist = Some([f.trim().to_string(), to.trim().to_string()]);
            }
            continue;
        }
        if t.starts_with("≠ Album:") {
            let rest = t.trim_start_matches("≠ Album:").trim();
            if let Some((f, to)) = rest.split_once(" -> ") {
                diff_album = Some([f.trim().to_string(), to.trim().to_string()]);
            }
            continue;
        }

        // Track diffs
        if t.starts_with("≠ (#") {
            diff_tracks.push(t.to_string());
            continue;
        }

        // Generic diff summary line (e.g. "≠ artist, data source, tracks, album")
        if t.starts_with('≠') && match_diff_summary.is_empty() {
            match_diff_summary = t.trim_start_matches('≠').trim().to_string();
            continue;
        }

        // Confirmed star fields (already match)
        if t.starts_with("* ") { continue; }

        // Source/label line: "MusicBrainz, Digital Media, ..."
        if (t.contains("MusicBrainz") || t.contains("Discogs") || t.contains("iTunes"))
            && match_score.is_some()
            && source_line.is_empty()
        {
            source_line = t.to_string();
            continue;
        }

        // Match display name — appears right after "Match (XX%):" before ≠ lines
        if match_score.is_some() && match_display.is_empty()
            && !t.starts_with('≠') && !t.starts_with('*')
            && !t.starts_with("https") && !t.contains("MusicBrainz")
        {
            match_display = t.to_string();
        }
    }

    // Finalize last candidate
    if let Some(c) = cur_cand.take() { candidates.push(c); }

    let match_info = match_score.map(|score| {
        let parts: Vec<&str> = source_line.splitn(8, ", ").collect();
        MatchInfo {
            score,
            display: match_display,
            source: parts.first().unwrap_or(&"").to_string(),
            format: parts.get(1).unwrap_or(&"").to_string(),
            year: parts.get(2).and_then(|y| y.parse().ok()),
            country: parts.get(3).map(|s| s.to_string()),
            label: parts.get(4).map(|s| s.to_string()),
            url: match_url,
            diff_summary: match_diff_summary,
            diff_artist,
            diff_album,
            diff_tracks,
            missing_tracks,
        }
    });

    AlbumPrompt { path: path.to_string(), items, prompt_type, default_candidate, match_info, candidates }
}

fn feed_candidate_line(line: &str, cur: &mut Option<Candidate>, list: &mut Vec<Candidate>) {
    // "1. (66.7%) Artist - Album"
    let first = line.chars().next().unwrap_or(' ');
    if first.is_ascii_digit() && line.contains('.') && line.contains('(') {
        if let Some(c) = cur.take() { list.push(c); }
        let dot = match line.find('.') { Some(d) => d, None => return };
        let index: usize = match line[..dot].trim().parse() { Ok(i) => i, Err(_) => return };
        let rest = line[dot + 1..].trim();
        let score = match parse_score(rest) { Some(s) => s, None => return };
        let after_pct = match rest.find("%) ") { Some(p) => p + 3, None => return };
        let display = rest.get(after_pct..).unwrap_or("").trim().to_string();
        *cur = Some(Candidate {
            index, score, display,
            diff_summary: String::new(),
            source: String::new(), format: String::new(),
            year: None, label: None, catalog: None, media: None,
        });
        return;
    }

    if let Some(c) = cur.as_mut() {
        let t = line.trim();
        if t.starts_with('≠') && c.diff_summary.is_empty() {
            c.diff_summary = t.trim_start_matches('≠').trim().to_string();
        } else if t.contains("MusicBrainz") || t.contains("Discogs") {
            let parts: Vec<&str> = t.splitn(8, ", ").collect();
            c.source = parts.first().unwrap_or(&"").to_string();
            c.format = parts.get(1).unwrap_or(&"").to_string();
            c.year = parts.get(2).and_then(|y| y.parse().ok());
            c.label = parts.get(4).map(|s| s.to_string());
            c.catalog = parts.get(5).map(|s| s.to_string());
            c.media = parts.get(6).map(|s| s.trim_end_matches(')').trim().to_string());
        }
    }
}
