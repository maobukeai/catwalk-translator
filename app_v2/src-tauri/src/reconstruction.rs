use crate::ocr::{BoundingBox, TextBlock};

fn is_cjk_or_fullwidth(c: char) -> bool {
    matches!(c,
        // CJK Unified Ideographs & Extensions
        '\u{4E00}'..='\u{9FFF}'
        | '\u{3400}'..='\u{4DBF}'
        | '\u{20000}'..='\u{2CEAF}'
        | '\u{F900}'..='\u{FAFF}'
        // CJK Symbols and Punctuation (e.g. 、。 《》【】〔〕〖〗)
        | '\u{3000}'..='\u{303F}'
        // Fullwidth Forms & Halfwidth CJK punctuation (e.g. ，！：；？（）)
        | '\u{FF01}'..='\u{FF60}'
        | '\u{FFE0}'..='\u{FFEE}'
        // Common CJK Quotes and dashes
        | '\u{2018}'..='\u{201F}'
        | '\u{2014}' | '\u{2026}'
        // Japanese Hiragana, Katakana & Kana extensions
        | '\u{3040}'..='\u{309F}'
        | '\u{30A0}'..='\u{30FF}'
        | '\u{31F0}'..='\u{31FF}'
        // Korean Hangul
        | '\u{AC00}'..='\u{D7AF}'
        | '\u{1100}'..='\u{11FF}'
        | '\u{3130}'..='\u{318F}'
        // Bopomofo
        | '\u{3100}'..='\u{312F}'
    )
}

pub struct LineClusterer;

impl LineClusterer {
    pub fn cluster_into_lines(mut blocks: Vec<TextBlock>, _threshold: f32) -> Vec<Vec<TextBlock>> {
        if blocks.is_empty() {
            return Vec::new();
        }

        // Sort blocks primarily by y coordinate, secondarily by x
        blocks.sort_by(|a, b| {
            a.box_rect
                .y
                .cmp(&b.box_rect.y)
                .then_with(|| a.box_rect.x.cmp(&b.box_rect.x))
        });

        let mut lines: Vec<Vec<TextBlock>> = Vec::new();

        for block in blocks {
            let mut added = false;
            let y2 = block.box_rect.y;
            let h2 = (block.box_rect.height as i32).max(1);

            for line in lines.iter_mut() {
                // Compare against the line's running union bbox (not just its first
                // block): once a line has merged several blocks, its first block
                // alone must not let the group swallow the next visual line.
                let (union_y, union_bottom) = line.iter().fold(
                    (i32::MAX, i32::MIN),
                    |(min_y, max_y), b| {
                        (
                            min_y.min(b.box_rect.y),
                            max_y.max(b.box_rect.y + b.box_rect.height as i32),
                        )
                    },
                );
                let y1 = union_y;
                let h1 = (union_bottom - union_y).max(1);

                let overlap = (y1 + h1).min(y2 + h2) - y1.max(y2);
                let min_h = (h1.min(h2) as f32).max(1.0);

                let c1 = y1 as f32 + h1 as f32 * 0.5;
                let c2 = y2 as f32 + h2 as f32 * 0.5;
                let center_diff = (c1 - c2).abs();

                // Same line = real vertical overlap, or centers within 0.6× the
                // SHORTER height. Using min_h (instead of the old max_h*0.5) keeps
                // tall blocks from absorbing the neighbouring line.
                let is_same_line = (overlap > 0 && (overlap as f32 / min_h) >= 0.40)
                    || (center_diff <= min_h * 0.6);

                if is_same_line {
                    line.push(block.clone());
                    added = true;
                    break;
                }
            }

            if !added {
                lines.push(vec![block]);
            }
        }

        // Sort each line horizontally by x
        for line in lines.iter_mut() {
            line.sort_by_key(|b| b.box_rect.x);
        }

        lines
    }
}

pub struct WordMerger;

impl WordMerger {
    pub fn merge_line(line_blocks: Vec<TextBlock>, _gap_threshold: f32) -> TextBlock {
        if line_blocks.is_empty() {
            return TextBlock {
                text: String::new(),
                confidence: 1.0,
                box_rect: BoundingBox {
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                },
            };
        }

        // Defensive multi-line split: when clustering still groups two visual
        // lines together, split by vertical center and join with '\n' so the
        // frontend can divide the union box height by the real line count for
        // font-size inference (otherwise the font is sized to the full height
        // and the translated card renders twice as large as the original).
        let mut valid: Vec<&TextBlock> = line_blocks
            .iter()
            .filter(|b| !b.text.trim().is_empty())
            .collect();
        if valid.is_empty() {
            let first = &line_blocks[0];
            return TextBlock {
                text: String::new(),
                confidence: first.confidence,
                box_rect: first.box_rect,
            };
        }

        let mut heights: Vec<f32> = valid.iter().map(|b| b.box_rect.height as f32).collect();
        heights.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median_h = heights[heights.len() / 2].max(1.0);

        valid.sort_by_key(|b| b.box_rect.y + (b.box_rect.height as i32) / 2);
        let mut sub_lines: Vec<Vec<&TextBlock>> = Vec::new();
        let mut last_center = f32::MIN;
        for b in valid.iter().copied() {
            let center = b.box_rect.y as f32 + b.box_rect.height as f32 * 0.5;
            if sub_lines.is_empty() || (center - last_center).abs() > median_h * 0.6 {
                sub_lines.push(vec![b]);
            } else {
                sub_lines.last_mut().unwrap().push(b);
            }
            last_center = center;
        }

        let mut merged_text = String::new();
        let mut min_x = i32::MAX;
        let mut min_y = i32::MAX;
        let mut max_x = i32::MIN;
        let mut max_y = i32::MIN;
        let mut total_confidence = 0.0f32;
        let mut valid_blocks_count = 0;

        for sub in &sub_lines {
            let mut sorted: Vec<&TextBlock> = sub.iter().copied().collect();
            sorted.sort_by_key(|b| b.box_rect.x);

            let mut sub_text = String::new();
            for b in sorted {
                if !sub_text.is_empty() {
                    let prev_char = sub_text.chars().last();
                    let next_char = b.text.chars().next();

                    let needs_space = match (prev_char, next_char) {
                        (Some(p), Some(n)) => {
                            !p.is_whitespace()
                                && !n.is_whitespace()
                                && !is_cjk_or_fullwidth(p)
                                && !is_cjk_or_fullwidth(n)
                        }
                        _ => false,
                    };

                    if needs_space {
                        sub_text.push(' ');
                    }
                }

                sub_text.push_str(&b.text);
                total_confidence += b.confidence;
                valid_blocks_count += 1;

                min_x = min_x.min(b.box_rect.x);
                min_y = min_y.min(b.box_rect.y);
                max_x = max_x.max(b.box_rect.x + b.box_rect.width as i32);
                max_y = max_y.max(b.box_rect.y + b.box_rect.height as i32);
            }

            if sub_text.is_empty() {
                continue;
            }
            if !merged_text.is_empty() {
                merged_text.push('\n');
            }
            merged_text.push_str(&sub_text);
        }

        if valid_blocks_count == 0 {
            let first = &line_blocks[0];
            return TextBlock {
                text: String::new(),
                confidence: first.confidence,
                box_rect: first.box_rect,
            };
        }

        let avg_confidence = total_confidence / (valid_blocks_count as f32);

        let final_x = min_x.max(0);
        let final_y = min_y.max(0);
        let final_w = (max_x - final_x).max(0) as u32;
        let final_h = (max_y - final_y).max(0) as u32;

        TextBlock {
            text: merged_text,
            confidence: avg_confidence,
            box_rect: BoundingBox {
                x: final_x,
                y: final_y,
                width: final_w,
                height: final_h,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_line_clusterer_vertical_overlap() {
        let blocks = vec![
            TextBlock {
                text: "Hello".into(),
                confidence: 0.95,
                box_rect: BoundingBox {
                    x: 10,
                    y: 100,
                    width: 50,
                    height: 20,
                },
            },
            TextBlock {
                text: "World".into(),
                confidence: 0.95,
                box_rect: BoundingBox {
                    x: 70,
                    y: 106, // 6px jitter, height 20 -> overlap = 14 / 20 = 70% >= 40%
                    width: 50,
                    height: 20,
                },
            },
            TextBlock {
                text: "NextLine".into(),
                confidence: 0.95,
                box_rect: BoundingBox {
                    x: 10,
                    y: 140, // Different line
                    width: 60,
                    height: 20,
                },
            },
        ];

        let lines = LineClusterer::cluster_into_lines(blocks, 8.0);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].len(), 2);
        assert_eq!(lines[1].len(), 1);
    }

    #[test]
    fn test_word_merger_cjk_and_english() {
        // CJK characters should not have spaces inserted
        let cjk_blocks = vec![
            TextBlock {
                text: "这是".into(),
                confidence: 0.9,
                box_rect: BoundingBox {
                    x: 10,
                    y: 10,
                    width: 30,
                    height: 20,
                },
            },
            TextBlock {
                text: "测试".into(),
                confidence: 0.9,
                box_rect: BoundingBox {
                    x: 40,
                    y: 10,
                    width: 30,
                    height: 20,
                },
            },
        ];
        let merged_cjk = WordMerger::merge_line(cjk_blocks, 20.0);
        assert_eq!(merged_cjk.text, "这是测试");
        assert_eq!(merged_cjk.box_rect.x, 10);
        assert_eq!(merged_cjk.box_rect.width, 60);

        // English words should have spaces inserted
        let eng_blocks = vec![
            TextBlock {
                text: "Principled".into(),
                confidence: 0.9,
                box_rect: BoundingBox {
                    x: 10,
                    y: 10,
                    width: 50,
                    height: 20,
                },
            },
            TextBlock {
                text: "BSDF".into(),
                confidence: 0.9,
                box_rect: BoundingBox {
                    x: 65,
                    y: 10,
                    width: 40,
                    height: 20,
                },
            },
        ];
        let merged_eng = WordMerger::merge_line(eng_blocks, 20.0);
        assert_eq!(merged_eng.text, "Principled BSDF");
        assert_eq!(merged_eng.box_rect.x, 10);
        assert_eq!(merged_eng.box_rect.width, 95);
    }
}

