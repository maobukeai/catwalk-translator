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
    /// Maximum horizontal gap for two blocks to sit on the same visual line,
    /// derived from the shorter block's height and clamped to sane absolutes:
    /// - floor 24px keeps split fragments of small UI text together;
    /// - cap 200px is what separates layout COLUMNS — a two-column page has a
    ///   ≥250px gutter, and without a cap a tall heading vertically spanning a
    ///   right-column row chained the whole foreign column into one line.
    ///
    /// Use the caller threshold as a floor, with a modest height-aware allowance.
    fn max_line_gap(h_ref: f32, threshold: f32) -> f32 {
        // Keep the caller's threshold meaningful and scale only modestly with
        // glyph height. The old 24px floor joined separate short UI labels and
        // CJK buttons into one sentence.
        threshold.max(h_ref * 0.80).clamp(6.0, 18.0)
    }

    /// Pixel gap between two boxes (0 when they already overlap horizontally).
    fn horizontal_gap(a: &BoundingBox, b: &BoundingBox) -> f32 {
        let a_right = a.x + a.width as i32;
        let b_right = b.x + b.width as i32;
        let gap = if a_right <= b.x {
            b.x - a_right
        } else if b_right <= a.x {
            a.x - b_right
        } else {
            0
        };
        gap as f32
    }

    /// Vertical alignment test for a candidate PAIR (not a union bbox): real
    /// overlap ≥40% of the shorter box, or centers within 0.6× of it. Using
    /// min_h keeps tall blocks from absorbing the neighbouring line.
    fn pair_same_row(a: &BoundingBox, b: &BoundingBox) -> bool {
        let h1 = (a.height as f32).max(1.0);
        let h2 = (b.height as f32).max(1.0);
        let overlap = (a.y + a.height as i32).min(b.y + b.height as i32) - a.y.max(b.y);
        let min_h = h1.min(h2).max(1.0);
        let center_diff = (a.y as f32 + h1 * 0.5 - (b.y as f32 + h2 * 0.5)).abs();
        (overlap > 0 && (overlap as f32 / min_h) >= 0.40) || center_diff <= min_h * 0.6
    }

    pub fn cluster_into_lines(mut blocks: Vec<TextBlock>, threshold: f32) -> Vec<Vec<TextBlock>> {
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
            let mut matches = Vec::new();
            for (index, line) in lines.iter().enumerate() {
                // Same line requires BOTH vertical alignment AND horizontal
                // proximity to some member. Pairwise member checks (instead of
                // the old line-union bbox) stop chain absorption: a union bbox
                // grows as blocks merge, letting each next right-column row
                // overlap its bottom edge and join — mixing two columns into
                // one "line". With pairwise + gap cap, every cross-column pair
                // fails the gap test, so the chain can never start.
                let matched = line.iter().any(|m| {
                    Self::pair_same_row(&m.box_rect, &block.box_rect)
                        && Self::horizontal_gap(&m.box_rect, &block.box_rect)
                            <= Self::max_line_gap(
                                m.box_rect.height.min(block.box_rect.height) as f32,
                                threshold,
                            )
                });
                if matched {
                    matches.push(index);
                }
            }

            if let Some(&first) = matches.first() {
                lines[first].push(block);
                // Detection order is y-first, so a middle fragment can arrive
                // after the left and right halves were placed in separate
                // groups. Reconnect only groups with the same row anchor;
                // otherwise a tall glyph could bridge two physical rows.
                for &other in matches.iter().skip(1).rev() {
                    let a = &lines[first][0].box_rect;
                    let b = &lines[other][0].box_rect;
                    let center_a = a.y as f32 + a.height as f32 * 0.5;
                    let center_b = b.y as f32 + b.height as f32 * 0.5;
                    let anchor_tolerance = a.height.min(b.height) as f32 * 0.45;
                    if (center_a - center_b).abs() <= anchor_tolerance {
                        let joined = lines.remove(other);
                        lines[first].extend(joined);
                    }
                }
            } else {
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
    /// Rejoin short detector fragments on one physical terminal row. Ordinary
    /// prose/UI keeps its existing segmentation; callers must gate this to a
    /// dense dark log scene, where translating `npm`, `run`, and `dev` as three
    /// independent overlay cards is visibly worse than translating the row.
    pub fn merge_terminal_row_fragments(mut blocks: Vec<TextBlock>) -> Vec<TextBlock> {
        blocks.sort_by_key(|block| (block.box_rect.y, block.box_rect.x));
        let mut rows: Vec<Vec<TextBlock>> = Vec::new();
        for block in blocks {
            let center = block.box_rect.y + block.box_rect.height as i32 / 2;
            if block.box_rect.y >= 36 {
                if let Some(row) = rows.iter_mut().find(|row| {
                    let anchor = row[0].box_rect;
                    let anchor_center = anchor.y + anchor.height as i32 / 2;
                    (center - anchor_center).abs() <= 4
                        && (block.box_rect.height as i32 - anchor.height as i32).abs() <= 8
                }) {
                    row.push(block);
                    continue;
                }
            }
            rows.push(vec![block]);
        }

        let mut merged = Vec::new();
        for mut row in rows {
            row.sort_by_key(|block| block.box_rect.x);
            let mut run: Vec<TextBlock> = Vec::new();
            for block in row {
                let boundary = run.last().is_some_and(|last| {
                    let gap = block.box_rect.x - last.box_rect.x - last.box_rect.width as i32;
                    let overlap = (-gap).max(0) as u32;
                    gap > 28 || overlap > last.box_rect.width.min(block.box_rect.width) / 5
                });
                if boundary {
                    if let Some(joined) = Self::merge_terminal_cluster(&run) { merged.push(joined); }
                    run.clear();
                }
                run.push(block);
            }
            if let Some(joined) = Self::merge_terminal_cluster(&run) { merged.push(joined); }
        }
        merged.sort_by_key(|block| (block.box_rect.y, block.box_rect.x));
        merged
    }

    fn merge_terminal_cluster(cluster: &[TextBlock]) -> Option<TextBlock> {
        let mut merged = Self::merge_single_cluster(cluster)?;
        let mut text = String::new();
        for (index, block) in cluster.iter().enumerate() {
            if index > 0 {
                let previous = &cluster[index - 1];
                let gap = block.box_rect.x - previous.box_rect.x - previous.box_rect.width as i32;
                let height = block.box_rect.height.min(previous.box_rect.height).max(1) as f32;
                let adjoining_cjk = text.chars().last().is_some_and(is_cjk_or_fullwidth)
                    && block.text.chars().next().is_some_and(is_cjk_or_fullwidth);
                // Detector fragments inside one Chinese phrase can have a
                // 7–8px gutter at this font size. Treat that as glyph spacing,
                // while retaining visibly wider gaps between separate cells.
                let space_threshold = if adjoining_cjk { height * 0.65 } else { height * 0.35 };
                if gap as f32 >= space_threshold
                    && !text.chars().last().is_some_and(char::is_whitespace)
                    && !block.text.chars().next().is_some_and(char::is_whitespace)
                {
                    text.push(' ');
                }
            }
            text.push_str(&block.text);
        }
        merged.text = text;
        Some(merged)
    }

    /// OCR detectors often cut a Chinese paragraph into phrase-sized boxes.
    /// Keep short UI labels separate, but reunite dense prose on one physical
    /// row before translation; otherwise every phrase gets its own card and the
    /// gaps between cards look like arbitrary spaces in the sentence.
    pub fn merge_prose_rows(mut blocks: Vec<TextBlock>) -> Vec<TextBlock> {
        if blocks.len() < 2 {
            return blocks;
        }
        blocks.sort_by_key(|block| (block.box_rect.y, block.box_rect.x));
        let mut rows: Vec<Vec<TextBlock>> = Vec::new();
        for block in blocks {
            if let Some(row) = rows.iter_mut().find(|row| {
                let anchor = &row[0].box_rect;
                let other = &block.box_rect;
                let center_delta = ((anchor.y + anchor.height as i32 / 2)
                    - (other.y + other.height as i32 / 2)).abs();
                LineClusterer::pair_same_row(anchor, other)
                    && center_delta <= (anchor.height.min(other.height) as f32 * 0.45).max(4.0) as i32
            }) {
                row.push(block);
            } else {
                rows.push(vec![block]);
            }
        }

        let mut output = Vec::new();
        for mut row in rows {
            row.sort_by_key(|block| block.box_rect.x);
            let mut run: Vec<TextBlock> = Vec::new();
            for block in row {
                let previous = run.last();
                let boundary = previous.is_some_and(|last| {
                    let gap = block.box_rect.x
                        - (last.box_rect.x + last.box_rect.width as i32);
                    let max_gap = (last.box_rect.height.min(block.box_rect.height) as f32 * 2.1)
                        .clamp(20.0, 38.0);
                    let substantial_overlap = gap < 0
                        && -gap > (last.box_rect.width.min(block.box_rect.width) as f32 * 0.2) as i32;
                    let list_marker = last.text.trim().chars().all(|c| c.is_ascii_digit())
                        && last.text.trim().chars().count() <= 2;
                    gap as f32 > max_gap || substantial_overlap || list_marker
                });
                if boundary {
                    Self::flush_prose_run(&mut run, &mut output);
                }
                run.push(block);
            }
            Self::flush_prose_run(&mut run, &mut output);
        }
        output.sort_by_key(|block| (block.box_rect.y, block.box_rect.x));
        output
    }

    fn flush_prose_run(run: &mut Vec<TextBlock>, output: &mut Vec<TextBlock>) {
        let cjk_lens: Vec<usize> = run.iter().map(|block| {
            block.text.chars().filter(|c| is_cjk_or_fullwidth(*c)).count()
        }).collect();
        let total: usize = cjk_lens.iter().sum();
        let substantial = cjk_lens.iter().filter(|len| **len >= 7).count();
        let span = run.last().unwrap().box_rect.x + run.last().unwrap().box_rect.width as i32
            - run.first().unwrap().box_rect.x;
        let punctuated_sentence = run.len() >= 3 && total >= 14 && span >= 250
            && run.iter().any(|block| block.text.chars().any(|c| matches!(c, '。' | '，' | '；')));
        let prose = run.len() >= 2 && total >= 26
            && (substantial >= 2
                || (run.len() >= 4 && total >= 34 && total / run.len() >= 4))
            || punctuated_sentence;
        if !prose {
            output.append(run);
            return;
        }

        let mut text = String::new();
        let mut min_x = i32::MAX;
        let mut min_y = i32::MAX;
        let mut max_x = i32::MIN;
        let mut max_y = i32::MIN;
        let mut weighted_confidence = 0.0f32;
        let mut weight = 0usize;
        for block in run.drain(..) {
            if !text.is_empty() {
                let previous = text.chars().last().unwrap();
                let next = block.text.chars().next().unwrap_or_default();
                if previous.is_ascii_alphanumeric() && next.is_ascii_alphanumeric() {
                    text.push(' ');
                }
            }
            text.push_str(&block.text);
            min_x = min_x.min(block.box_rect.x);
            min_y = min_y.min(block.box_rect.y);
            max_x = max_x.max(block.box_rect.x + block.box_rect.width as i32);
            max_y = max_y.max(block.box_rect.y + block.box_rect.height as i32);
            let chars = block.text.chars().count().max(1);
            weighted_confidence += block.confidence * chars as f32;
            weight += chars;
        }
        output.push(TextBlock {
            text,
            confidence: weighted_confidence / weight as f32,
            box_rect: BoundingBox {
                x: min_x,
                y: min_y,
                width: (max_x - min_x).max(0) as u32,
                height: (max_y - min_y).max(0) as u32,
            },
        });
    }

    pub fn merge_line(line_blocks: Vec<TextBlock>, gap_threshold: f32) -> TextBlock {
        let segments = Self::merge_line_segments(line_blocks, gap_threshold);
        if segments.is_empty() {
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
        if segments.len() == 1 {
            return segments.into_iter().next().unwrap();
        }
        // 多段时以换行拼接，保留向后兼容
        let mut text = String::new();
        let mut min_x = i32::MAX;
        let mut min_y = i32::MAX;
        let mut max_x = i32::MIN;
        let mut max_y = i32::MIN;
        let mut total_conf = 0.0f32;
        for s in &segments {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(&s.text);
            total_conf += s.confidence;
            min_x = min_x.min(s.box_rect.x);
            min_y = min_y.min(s.box_rect.y);
            max_x = max_x.max(s.box_rect.x + s.box_rect.width as i32);
            max_y = max_y.max(s.box_rect.y + s.box_rect.height as i32);
        }
        TextBlock {
            text,
            confidence: total_conf / segments.len() as f32,
            box_rect: BoundingBox {
                x: min_x,
                y: min_y,
                width: (max_x - min_x) as u32,
                height: (max_y - min_y) as u32,
            },
        }
    }

    /// 将同一视觉行按水平间距 threshold 切分为若干个独立的语义段（例如表格不同列、独立按钮）：
    /// 间距 <= gap_threshold 的相邻词合并为一个 TextBlock（如 "Principled" + "BSDF"）；
    /// 间距 > gap_threshold 的相邻块则作为独立的 TextBlock 返回，绝不跨列串联！
    pub fn merge_line_segments(line_blocks: Vec<TextBlock>, gap_threshold: f32) -> Vec<TextBlock> {
        if line_blocks.is_empty() {
            return Vec::new();
        }

        let mut valid: Vec<TextBlock> = line_blocks
            .into_iter()
            .filter(|b| !b.text.trim().is_empty())
            .collect();
        if valid.is_empty() {
            return Vec::new();
        }

        let mut heights: Vec<f32> = valid.iter().map(|b| b.box_rect.height as f32).collect();
        heights.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median_h = heights[heights.len() / 2].max(1.0);

        valid.sort_by_key(|b| b.box_rect.y + (b.box_rect.height as i32) / 2);
        let mut sub_lines: Vec<Vec<TextBlock>> = Vec::new();
        let mut last_center = f32::MIN;
        for b in valid {
            let center = b.box_rect.y as f32 + b.box_rect.height as f32 * 0.5;
            if sub_lines.is_empty() || (center - last_center).abs() > median_h * 0.6 {
                sub_lines.push(vec![b]);
            } else {
                sub_lines.last_mut().unwrap().push(b);
            }
            last_center = center;
        }

        let mut result_blocks = Vec::new();

        for mut sub in sub_lines {
            if sub.is_empty() {
                continue;
            }
            sub.sort_by_key(|b| b.box_rect.x);

            // 在水平方向上按 gap_threshold 分割为独立的词簇 (clusters)
            let mut clusters: Vec<Vec<TextBlock>> = Vec::new();
            for b in sub {
                let belongs_to_last = if let Some(last_cluster) = clusters.last() {
                    let last = last_cluster.last().unwrap();
                    let last_right = last.box_rect.x + last.box_rect.width as i32;
                    let gap = b.box_rect.x - last_right;
                    // A normal inter-word gutter is a fraction of text height.
                    // The old hard 12px floor merged visually separate CJK/UI
                    // labels, especially at 100% DPI.
                    let last_cjk = last.text.chars().filter(|c| is_cjk_or_fullwidth(*c)).count();
                    let next_cjk = b.text.chars().filter(|c| is_cjk_or_fullwidth(*c)).count();
                    // Multi-character CJK chunks separated by visible space are
                    // overwhelmingly likely to be neighbouring UI labels rather
                    // than fragments of one word. Single CJK glyph fragments
                    // still use the normal recovery threshold.
                    let sentence_script_transition = last.text.trim_end().chars().last()
                        .is_some_and(|ch| ch.is_ascii_alphabetic())
                        && b.text.trim_start().chars().next()
                            .is_some_and(is_cjk_or_fullwidth);
                    let max_gap = if sentence_script_transition {
                        // "修改 Rust 代码" is one sentence even when a font
                        // leaves a slightly wider Latin→CJK gutter. Do not
                        // apply the compact CJK-menu threshold to this case.
                        (median_h * 0.85).clamp(10.0, 14.0)
                    } else if last_cjk >= 2 && next_cjk >= 2 {
                        (median_h * 0.20).clamp(2.0, 4.0)
                    } else {
                        gap_threshold.min(median_h * 0.55).max(4.0)
                    };
                    let substantial_overlap = gap < 0
                        && -gap > (last.box_rect.width.min(b.box_rect.width) as f32 * 0.2) as i32;
                    !substantial_overlap && (gap as f32) <= max_gap
                } else {
                    false
                };

                if belongs_to_last {
                    clusters.last_mut().unwrap().push(b);
                } else {
                    clusters.push(vec![b]);
                }
            }

            for cluster in clusters {
                if let Some(merged) = Self::merge_single_cluster(&cluster) {
                    result_blocks.push(merged);
                }
            }
        }

        result_blocks
    }

    fn merge_single_cluster(cluster: &[TextBlock]) -> Option<TextBlock> {
        if cluster.is_empty() {
            return None;
        }
        let mut text = String::new();
        let mut min_x = i32::MAX;
        let mut min_y = i32::MAX;
        let mut max_x = i32::MIN;
        let mut max_y = i32::MIN;
        let mut total_confidence = 0.0f32;

        for (index, b) in cluster.iter().enumerate() {
            if !text.is_empty() {
                let prev_char = text.chars().last();
                let next_char = b.text.chars().next();
                let needs_space = match (prev_char, next_char) {
                    (Some(p), Some(n)) => {
                        let both_non_cjk = !is_cjk_or_fullwidth(p) && !is_cjk_or_fullwidth(n);
                        let mixed_script = (p.is_ascii_alphanumeric() && is_cjk_or_fullwidth(n))
                            || (is_cjk_or_fullwidth(p) && n.is_ascii_alphanumeric());
                        let visible_gap = cluster.get(index - 1).is_some_and(|previous| {
                            let gap = b.box_rect.x - previous.box_rect.x
                                - previous.box_rect.width as i32;
                            let h = b.box_rect.height.min(previous.box_rect.height).max(1) as f32;
                            (gap as f32) >= h * 0.30
                        });
                        !p.is_whitespace() && !n.is_whitespace()
                            && (both_non_cjk || (mixed_script && visible_gap))
                    }
                    _ => false,
                };
                if needs_space {
                    text.push(' ');
                }
            }
            text.push_str(&b.text);
            total_confidence += b.confidence;
            min_x = min_x.min(b.box_rect.x);
            min_y = min_y.min(b.box_rect.y);
            max_x = max_x.max(b.box_rect.x + b.box_rect.width as i32);
            max_y = max_y.max(b.box_rect.y + b.box_rect.height as i32);
        }

        let final_x = min_x.max(0);
        let final_y = min_y.max(0);
        let final_w = (max_x - final_x).max(0) as u32;
        let final_h = (max_y - final_y).max(0) as u32;

        Some(TextBlock {
            text,
            confidence: total_confidence / cluster.len() as f32,
            box_rect: BoundingBox {
                x: final_x,
                y: final_y,
                width: final_w,
                height: final_h,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_row_merges_close_fragments_without_crossing_rows_or_titlebar() {
        let block = |text: &str, x, y, width| TextBlock {
            text: text.into(), confidence: 0.98,
            box_rect: BoundingBox { x, y, width, height: 19 },
        };
        let merged = WordMerger::merge_terminal_row_fragments(vec![
            block("npm li", 46, 15, 39), block("@tauri-apps", 95, 16, 122),
            block("[*]", 18, 102, 22), block("正在检测并释放", 53, 102, 121),
            block("1420 端与历史进程", 187, 102, 167),
            block("[*]", 18, 160, 22), block("正在启动服务", 53, 160, 136),
            block("left", 10, 220, 45), block("right column", 130, 220, 95),
        ]);
        assert_eq!(merged.len(), 6);
        assert_eq!(merged[0].text, "npm li");
        assert_eq!(merged[1].text, "@tauri-apps");
        assert_eq!(merged[2].text, "[*] 正在检测并释放 1420 端与历史进程");
        assert_eq!(merged[2].box_rect.width, 336);
        assert_eq!(merged[3].text, "[*] 正在启动服务");
        assert_eq!(merged[4].text, "left");
        assert_eq!(merged[5].text, "right column");
    }

    #[test]
    fn terminal_chinese_fragments_do_not_gain_false_word_spaces() {
        let block = |text: &str, x, width| TextBlock {
            text: text.into(), confidence: 0.98,
            box_rect: BoundingBox { x, y: 160, width, height: 18 },
        };
        let joined = WordMerger::merge_terminal_row_fragments(vec![
            block("[*]", 18, 22), block("正在启动热重载开", 53, 136),
            block("发调试服务", 196, 85),
        ]);
        assert_eq!(joined.len(), 1);
        assert_eq!(joined[0].text, "[*] 正在启动热重载开发调试服务");

        let separate = WordMerger::merge_terminal_row_fragments(vec![
            block("状态正常", 53, 72), block("下一列", 143, 54),
        ]);
        assert_eq!(separate[0].text, "状态正常 下一列",
            "a visibly wider terminal column gutter still denotes separation");
    }

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
    fn test_line_clusterer_rejects_cross_column_merge() {
        // Two-column page: the tall left heading vertically spans the right
        // column's first row — the old union-bbox check chained them into one
        // line. The ≥200px column gutter must veto the merge via the gap cap.
        let blocks = vec![
            TextBlock {
                text: "One TokenRouter".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 10, y: 100, width: 600, height: 60 },
            },
            TextBlock {
                text: "Unified Model Access".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 950, y: 105, width: 200, height: 14 },
            },
            TextBlock {
                text: "All Models".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 10, y: 170, width: 200, height: 60 },
            },
        ];

        let lines = LineClusterer::cluster_into_lines(blocks, 8.0);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0][0].text, "One TokenRouter");
        assert_eq!(lines[1][0].text, "Unified Model Access");
        assert_eq!(lines[2][0].text, "All Models");
    }

    #[test]
    fn test_line_clusterer_splits_wide_same_row_gaps() {
        // Same visual row, but the ~90px gaps between separate UI labels
        // exceed the gap cap — they stay independent blocks instead of one
        // mashed "99.9% Smart Always-On" line.
        let blocks = vec![
            TextBlock {
                text: "99.9%".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 10, y: 100, width: 60, height: 24 },
            },
            TextBlock {
                text: "Smart".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 160, y: 100, width: 70, height: 24 },
            },
            TextBlock {
                text: "Always-On".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 310, y: 100, width: 90, height: 24 },
            },
        ];

        let lines = LineClusterer::cluster_into_lines(blocks, 8.0);
        assert_eq!(lines.len(), 3);
    }

    #[test]
    fn test_line_clusterer_merges_nearby_fragments() {
        // Two fragments of one label on the same row, 15px apart → same line.
        let blocks = vec![
            TextBlock {
                text: "Principled".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 10, y: 100, width: 80, height: 20 },
            },
            TextBlock {
                text: "BSDF".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 105, y: 104, width: 40, height: 20 },
            },
        ];

        let lines = LineClusterer::cluster_into_lines(blocks, 8.0);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].len(), 2);
    }

    #[test]
    fn test_short_equal_height_ui_labels_do_not_merge_across_gutter() {
        // Two independent two-character CJK controls on the same row. The old
        // 24px floor clustered and then concatenated them with no delimiter.
        let blocks = vec![
            TextBlock {
                text: "开始".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 10, y: 20, width: 36, height: 20 },
            },
            TextBlock {
                text: "退出".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 64, y: 20, width: 36, height: 20 },
            },
        ];
        let lines = LineClusterer::cluster_into_lines(blocks, 8.0);
        assert_eq!(lines.len(), 2);
    }

    #[test]
    fn late_middle_fragment_reconnects_one_physical_row() {
        // The right half arrives before the middle because its detected box
        // starts one pixel higher. Both halves must become one translation row.
        let blocks = vec![
            TextBlock { text: "修改".into(), confidence: 1.0,
                box_rect: BoundingBox { x: 280, y: 46, width: 42, height: 16 } },
            TextBlock { text: "代码自动重新编译".into(), confidence: 1.0,
                box_rect: BoundingBox { x: 383, y: 45, width: 205, height: 18 } },
            TextBlock { text: "Rust".into(), confidence: 1.0,
                box_rect: BoundingBox { x: 324, y: 47, width: 48, height: 15 } },
        ];
        let lines = LineClusterer::cluster_into_lines(blocks, 8.0);
        assert_eq!(lines.len(), 1);
        let merged = WordMerger::merge_line_segments(lines.into_iter().next().unwrap(), 20.0);
        assert_eq!(merged.len(), 1);
    }

    #[test]
    fn tall_bridge_does_not_join_neighboring_physical_rows() {
        let blocks = vec![
            TextBlock { text: "上行".into(), confidence: 1.0,
                box_rect: BoundingBox { x: 10, y: 10, width: 40, height: 30 } },
            TextBlock { text: "下行".into(), confidence: 1.0,
                box_rect: BoundingBox { x: 90, y: 25, width: 40, height: 15 } },
            TextBlock { text: "高字".into(), confidence: 1.0,
                box_rect: BoundingBox { x: 52, y: 26, width: 36, height: 30 } },
        ];
        let lines = LineClusterer::cluster_into_lines(blocks, 8.0);
        assert_eq!(lines.len(), 2);
    }

    #[test]
    fn test_word_merger_splits_small_ui_gutter() {
        let row = vec![
            TextBlock {
                text: "开始".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 10, y: 20, width: 36, height: 20 },
            },
            TextBlock {
                text: "退出".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 60, y: 20, width: 36, height: 20 },
            },
        ];
        let segments = WordMerger::merge_line_segments(row, 20.0);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].text, "开始");
        assert_eq!(segments[1].text, "退出");
    }

    #[test]
    fn test_word_merger_keeps_compact_multichar_cjk_buttons_separate() {
        let row = vec![
            TextBlock {
                text: "文件".into(),
                confidence: 0.98,
                box_rect: BoundingBox { x: 4, y: 10, width: 18, height: 17 },
            },
            TextBlock {
                text: "编辑".into(),
                confidence: 0.98,
                box_rect: BoundingBox { x: 29, y: 10, width: 18, height: 17 },
            },
        ];
        let segments = WordMerger::merge_line_segments(row, 20.0);
        assert_eq!(segments.len(), 2);
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

        // Preserve a real visual word gap at an ASCII/CJK boundary in a
        // mixed-language bubble; don't manufacture one for touching glyphs.
        let mixed = vec![
            TextBlock { text: "具集成到 vids.new".into(), confidence: 0.97,
                box_rect: BoundingBox { x: 43, y: 43, width: 115, height: 15 } },
            TextBlock { text: "中".into(), confidence: 1.0,
                box_rect: BoundingBox { x: 164, y: 43, width: 12, height: 15 } },
        ];
        assert_eq!(WordMerger::merge_line(mixed, 20.0).text, "具集成到 vids.new 中");
    }

    #[test]
    fn test_word_merger_segments_preserves_columns() {
        // 同一行的两个表格单元格，间距 40px > gap_threshold(20.0)
        // 必须返回 2 个独立的 TextBlock，绝不合并！
        let table_row = vec![
            TextBlock {
                text: "问题表现".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 50, y: 20, width: 80, height: 20 },
            },
            TextBlock {
                text: "修复前".into(),
                confidence: 0.95,
                box_rect: BoundingBox { x: 170, y: 20, width: 60, height: 20 },
            },
        ];
        let segments = WordMerger::merge_line_segments(table_row, 20.0);
        assert_eq!(segments.len(), 2, "两列间距 40px > 20px 必须保持独立");
        assert_eq!(segments[0].text, "问题表现");
        assert_eq!(segments[1].text, "修复前");
    }

    #[test]
    fn chinese_prose_fragments_rejoin_without_ocr_invented_spaces() {
        let block = |text: &str, x, y, width| TextBlock {
            text: text.into(),
            confidence: 0.98,
            box_rect: BoundingBox { x, y, width, height: 18 },
        };
        let blocks = vec![
            block("而且我认为", 68, 13, 67),
            block("下一步不该继续只盯着OCR模型。", 165, 13, 180),
            block("看过项目结构和现有测试后，", 354, 13, 173),
            block("我会这样排优先级：", 536, 13, 117),
            block("翻译结果的原位显示：", 67, 39, 130),
            block("重点验收字号、换行、背景擦除和滚动后的对齐。", 208, 39, 300),
        ];
        let merged = WordMerger::merge_prose_rows(blocks);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].text,
            "而且我认为下一步不该继续只盯着OCR模型。看过项目结构和现有测试后，我会这样排优先级：");
        assert_eq!(merged[1].text,
            "翻译结果的原位显示：重点验收字号、换行、背景擦除和滚动后的对齐。");
    }

    #[test]
    fn prose_rejoin_keeps_toolbar_labels_and_columns_separate() {
        let block = |text: &str, x, width| TextBlock {
            text: text.into(),
            confidence: 0.98,
            box_rect: BoundingBox { x, y: 20, width, height: 18 },
        };
        let toolbar = vec![
            block("文件", 4, 18), block("编辑", 32, 18), block("渲染", 60, 18),
            block("窗口", 88, 18), block("帮助", 116, 18),
        ];
        assert_eq!(WordMerger::merge_prose_rows(toolbar).len(), 5);
        let columns = vec![
            block("左栏是一段很长的中文说明内容。", 10, 210),
            block("右栏也是另一段很长的中文说明内容。", 300, 220),
        ];
        assert_eq!(WordMerger::merge_prose_rows(columns).len(), 2);
    }

    #[test]
    fn short_wrapped_prose_row_joins_when_it_contains_sentence_punctuation() {
        let row = vec![
            TextBlock { text: "写进文档。".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 67, y: 198, width: 61, height: 18 } },
            TextBlock { text: "目前README仍是".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 138, y: 198, width: 140, height: 18 } },
            TextBlock { text: "Tauri模板内容。".into(), confidence: 0.99,
                box_rect: BoundingBox { x: 286, y: 198, width: 91, height: 18 } },
        ];
        let merged = WordMerger::merge_prose_rows(row);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].text, "写进文档。目前README仍是Tauri模板内容。");
    }

    #[test]
    fn overlapping_ocr_hypotheses_do_not_become_one_oversized_card() {
        let blocks = vec![
            TextBlock { text: "Tiny标题原图已通过：两行完整，0/67错".into(),
                confidence: 0.96,
                box_rect: BoundingBox { x: 51, y: 486, width: 340, height: 19 } },
            TextBlock { text: "答：Small与Tiny同时可用时互补识别".into(),
                confidence: 0.86,
                box_rect: BoundingBox { x: 0, y: 497, width: 332, height: 21 } },
            TextBlock { text: "Blender复测还澄清了一点".into(),
                confidence: 0.99,
                box_rect: BoundingBox { x: 432, y: 488, width: 299, height: 14 } },
        ];
        let lines = LineClusterer::cluster_into_lines(blocks, 8.0);
        let segmented: Vec<_> = lines.into_iter()
            .flat_map(|line| WordMerger::merge_line_segments(line, 20.0)).collect();
        let merged = WordMerger::merge_prose_rows(segmented);
        assert_eq!(merged.len(), 3);
        assert!(merged.iter().all(|block| block.box_rect.height <= 21));
    }
}

