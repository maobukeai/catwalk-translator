//! Best-effort extraction of visible text exposed by the foreground app's
//! Windows UI Automation tree. This supplements (never replaces) pixel OCR.

use crate::models::{BoundingBox, PhysicalRect, TextBlock};

#[cfg(target_os = "windows")]
pub fn read_region_text(
    hwnd_raw: isize,
    capture_origin: (i32, i32),
    region: PhysicalRect,
) -> Vec<TextBlock> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation};

    if hwnd_raw == 0 || region.width == 0 || region.height == 0 {
        return Vec::new();
    }

    // UIA is an out-of-process COM client for many applications. Keep all calls
    // on this blocking worker, never the Tauri/UI thread. If this worker has an
    // incompatible COM apartment, gracefully fall back to image OCR.
    let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).is_ok() };
    if !initialized {
        return Vec::new();
    }

    let blocks = unsafe {
        let Ok(automation) =
            CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        else {
            CoUninitialize();
            return Vec::new();
        };
        let Ok(root) = automation.ElementFromHandle(HWND(hwnd_raw as *mut _)) else {
            CoUninitialize();
            return Vec::new();
        };
        let Ok(walker) = automation.ControlViewWalker() else {
            CoUninitialize();
            return Vec::new();
        };

        let mut collected = Vec::new();
        let mut visited = 0usize;
        let started = std::time::Instant::now();
        collect_control_text(
            &walker,
            &root,
            0,
            &mut visited,
            &mut collected,
            started,
            capture_origin,
            region,
        );
        CoUninitialize();
        collected
    };

    deduplicate_overlapping_text(blocks)
}

#[cfg(not(target_os = "windows"))]
pub fn read_region_text(
    _hwnd_raw: isize,
    _capture_origin: (i32, i32),
    _region: PhysicalRect,
) -> Vec<TextBlock> {
    Vec::new()
}

#[cfg(target_os = "windows")]
unsafe fn collect_control_text(
    walker: &windows::Win32::UI::Accessibility::IUIAutomationTreeWalker,
    parent: &windows::Win32::UI::Accessibility::IUIAutomationElement,
    depth: usize,
    visited: &mut usize,
    out: &mut Vec<TextBlock>,
    started: std::time::Instant,
    origin: (i32, i32),
    region: PhysicalRect,
) {
    use windows::Win32::UI::Accessibility::{
        IUIAutomationTextPattern, UIA_ButtonControlTypeId, UIA_CheckBoxControlTypeId,
        UIA_EditControlTypeId, UIA_HyperlinkControlTypeId, UIA_ListItemControlTypeId,
        UIA_MenuItemControlTypeId, UIA_RadioButtonControlTypeId, UIA_TabItemControlTypeId,
        UIA_TextControlTypeId, UIA_TextPatternId, UIA_TreeItemControlTypeId,
    };

    // Some custom-rendered apps expose huge or cyclic-looking trees. Bound both
    // depth and work so UIA can never dominate a screenshot operation.
    if depth >= 16 || *visited >= 256 || out.len() >= 128 || started.elapsed().as_millis() >= 220 {
        return;
    }
    let Ok(mut child) = walker.GetFirstChildElement(parent) else {
        return;
    };
    loop {
        if *visited >= 256 || out.len() >= 128 || started.elapsed().as_millis() >= 220 {
            break;
        }
        *visited += 1;

        let is_password = child.CurrentIsPassword().ok().is_some_and(|v| v.0 != 0);
        let name = if is_password {
            String::new()
        } else {
            child
                .CurrentName()
                .ok()
                .map(|b| b.to_string())
                .unwrap_or_default()
        };
        let control_type = child.CurrentControlType().ok();
        let mut has_visible_text = false;
        if !is_password {
            if let Ok(pattern) =
                child.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
            {
                let visible = read_visible_text_ranges(&pattern, origin, region, started);
                has_visible_text = !visible.is_empty();
                out.extend(visible);
            }
        }
        let is_text_control = control_type.is_some_and(|id| {
            [
                UIA_TextControlTypeId,
                UIA_EditControlTypeId,
                UIA_ButtonControlTypeId,
                UIA_CheckBoxControlTypeId,
                UIA_RadioButtonControlTypeId,
                UIA_HyperlinkControlTypeId,
                UIA_MenuItemControlTypeId,
                UIA_TabItemControlTypeId,
                UIA_ListItemControlTypeId,
                UIA_TreeItemControlTypeId,
            ]
            .contains(&id)
        });
        // A control Name may be an accessibility description rather than text
        // painted on screen. Its TextPattern visible ranges are more specific.
        if is_text_control && !is_password && !has_visible_text {
            let icon_prone = control_type.is_some_and(|id| {
                [UIA_ButtonControlTypeId, UIA_CheckBoxControlTypeId,
                    UIA_RadioButtonControlTypeId].contains(&id)
            });
            if let Some(block) = text_element_to_block(&child, name, origin, region, icon_prone) {
                out.push(block);
            }
        }

        collect_control_text(
            walker,
            &child,
            depth + 1,
            visited,
            out,
            started,
            origin,
            region,
        );
        let Ok(next) = walker.GetNextSiblingElement(&child) else {
            break;
        };
        child = next;
    }
}

#[cfg(target_os = "windows")]
unsafe fn read_visible_text_ranges(
    pattern: &windows::Win32::UI::Accessibility::IUIAutomationTextPattern,
    origin: (i32, i32),
    region: PhysicalRect,
    started: std::time::Instant,
) -> Vec<TextBlock> {
    let Ok(ranges) = pattern.GetVisibleRanges() else {
        return Vec::new();
    };
    let Ok(count) = ranges.Length() else {
        return Vec::new();
    };
    let mut blocks = Vec::new();
    for index in 0..count.clamp(0, 16) {
        let Ok(range) = ranges.GetElement(index) else {
            continue;
        };
        // Bound text copied out of a provider; a visible terminal viewport
        // normally stays well below this and stale document history is ignored.
        let text = range
            .GetText(8192)
            .ok()
            .map(|s| s.to_string())
            .unwrap_or_default();
        let Some(rects) = safearray_rectangles(range.GetBoundingRectangles().ok()) else {
            continue;
        };
        let mapped = text_lines_to_blocks(&text, &rects, origin, region);
        if mapped.is_empty() && !text.trim().is_empty() {
            blocks.extend(read_range_line_by_line(&range, origin, region, started));
        } else {
            blocks.extend(mapped);
        }
        if blocks.len() >= 128 {
            blocks.truncate(128);
            break;
        }
    }
    blocks
}

#[cfg(target_os = "windows")]
unsafe fn read_range_line_by_line(
    range: &windows::Win32::UI::Accessibility::IUIAutomationTextRange,
    origin: (i32, i32),
    region: PhysicalRect,
    started: std::time::Instant,
) -> Vec<TextBlock> {
    use windows::Win32::UI::Accessibility::{
        TextPatternRangeEndpoint_End, TextPatternRangeEndpoint_Start, TextUnit_Line,
    };

    let Ok(line_range) = range.Clone() else {
        return Vec::new();
    };
    // Start with a collapsed caret so ExpandToEnclosingUnit(Line) selects only
    // the first logical line, even if a provider exposes a multi-row range.
    if line_range
        .MoveEndpointByRange(
            TextPatternRangeEndpoint_End,
            &line_range,
            TextPatternRangeEndpoint_Start,
        )
        .is_err()
        || line_range.ExpandToEnclosingUnit(TextUnit_Line).is_err()
    {
        return Vec::new();
    }

    let mut blocks = Vec::new();
    for _ in 0..128 {
        if started.elapsed().as_millis() >= 220 {
            break;
        }
        // Moving a range can advance beyond the original visible viewport on
        // some providers; keep extraction bounded to GetVisibleRanges().
        let Ok(relative) = line_range.CompareEndpoints(
            TextPatternRangeEndpoint_Start,
            range,
            TextPatternRangeEndpoint_End,
        ) else {
            break;
        };
        if relative >= 0 {
            break;
        }
        let text = line_range
            .GetText(2048)
            .ok()
            .map(|value| value.to_string())
            .unwrap_or_default();
        let text = text.trim_end_matches(|c| c == '\r' || c == '\n');
        if !text.trim().is_empty() {
            if let Some(rects) = safearray_rectangles(line_range.GetBoundingRectangles().ok()) {
                if let Some(rect) = union_rectangles(&rects) {
                    blocks.extend(text_lines_to_blocks(text, &[rect], origin, region));
                }
            }
        }
        if line_range.Move(TextUnit_Line, 1).ok().unwrap_or(0) <= 0 {
            break;
        }
    }
    blocks
}

fn union_rectangles(rects: &[[f64; 4]]) -> Option<[f64; 4]> {
    let mut valid = rects.iter().filter(|rect| {
        rect.iter().all(|value| value.is_finite()) && rect[2] > 0.0 && rect[3] > 0.0
    });
    let first = *valid.next()?;
    let (left, top, right, bottom) = valid.fold(
        (first[0], first[1], first[0] + first[2], first[1] + first[3]),
        |(left, top, right, bottom), rect| {
            (
                left.min(rect[0]),
                top.min(rect[1]),
                right.max(rect[0] + rect[2]),
                bottom.max(rect[1] + rect[3]),
            )
        },
    );
    Some([left, top, right - left, bottom - top])
}

#[cfg(target_os = "windows")]
unsafe fn safearray_rectangles(
    array: Option<*mut windows::Win32::System::Com::SAFEARRAY>,
) -> Option<Vec<[f64; 4]>> {
    use windows::Win32::System::Ole::{
        SafeArrayAccessData, SafeArrayDestroy, SafeArrayGetDim, SafeArrayGetElemsize,
        SafeArrayGetLBound, SafeArrayGetUBound, SafeArrayUnaccessData,
    };
    let array = array?;
    if array.is_null() {
        return None;
    }
    let result = (|| {
        if SafeArrayGetDim(array) != 1
            || SafeArrayGetElemsize(array) != std::mem::size_of::<f64>() as u32
        {
            return None;
        }
        let lower = SafeArrayGetLBound(array, 1).ok()?;
        let upper = SafeArrayGetUBound(array, 1).ok()?;
        let count = upper.checked_sub(lower)?.checked_add(1)? as usize;
        if count == 0 || count > 4096 || count % 4 != 0 {
            return None;
        }
        let mut data = std::ptr::null_mut();
        SafeArrayAccessData(array, &mut data).ok()?;
        let values = if data.is_null() {
            None
        } else {
            Some(std::slice::from_raw_parts(data.cast::<f64>(), count).to_vec())
        };
        let _ = SafeArrayUnaccessData(array);
        let values = values?;
        Some(
            values
                .chunks_exact(4)
                .map(|v| [v[0], v[1], v[2], v[3]])
                .collect(),
        )
    })();
    let _ = SafeArrayDestroy(array);
    result
}

#[cfg(target_os = "windows")]
unsafe fn text_element_to_block(
    element: &windows::Win32::UI::Accessibility::IUIAutomationElement,
    text: String,
    origin: (i32, i32),
    region: PhysicalRect,
    icon_prone: bool,
) -> Option<TextBlock> {
    let text = text.trim().to_string();
    let char_count = text.chars().filter(|c| !c.is_whitespace()).count();
    if char_count == 0 || char_count > 160 || text.contains('\r') || text.contains('\n') {
        return None;
    }
    if !text
        .chars()
        .any(|c| c.is_alphanumeric() || ('\u{3400}'..='\u{9fff}').contains(&c))
    {
        return None;
    }
    if element.CurrentIsOffscreen().ok().is_some_and(|v| v.0 != 0) {
        return None;
    }
    let rect = element.CurrentBoundingRectangle().ok()?;

    // UIA rectangles use virtual-screen desktop coordinates; the screenshot is
    // stored from its virtual origin. Clamp partial overlaps to the selection.
    let left = rect.left.saturating_sub(origin.0).max(region.x);
    let top = rect.top.saturating_sub(origin.1).max(region.y);
    let right = rect
        .right
        .saturating_sub(origin.0)
        .min(region.x.saturating_add(region.width as i32));
    let bottom = rect
        .bottom
        .saturating_sub(origin.1)
        .min(region.y.saturating_add(region.height as i32));
    let width = right.saturating_sub(left);
    let height = bottom.saturating_sub(top);
    let region_area = (region.width as u64).saturating_mul(region.height as u64);
    let box_area = (width.max(0) as u64).saturating_mul(height.max(0) as u64);
    if width < 4 || height < 5 || box_area == 0 || box_area > region_area.saturating_mul(3) / 5 {
        return None;
    }
    if icon_prone && is_icon_sized_accessible_name(&text, width, height) {
        return None;
    }

    Some(TextBlock {
        text,
        confidence: 0.99,
        box_rect: BoundingBox {
            x: left - region.x,
            y: top - region.y,
            width: width as u32,
            height: height as u32,
        },
    })
}

/// A square icon button can have a descriptive UIA Name ("Close", "关闭")
/// that is never painted on screen. Do not inject that name as OCR text when
/// its estimated glyphs physically cannot fit inside the visible button.
fn is_icon_sized_accessible_name(text: &str, width: i32, height: i32) -> bool {
    if width <= 0 || height <= 0 || width > height.saturating_mul(2) {
        return false;
    }
    let chars: Vec<char> = text.chars().filter(|c| !c.is_whitespace()).collect();
    if chars.len() == 1 {
        return true;
    }
    let units: f32 = chars.iter().map(|c| {
        if ('\u{3400}'..='\u{9fff}').contains(c) { 1.0 }
        else if c.is_ascii_alphanumeric() { 0.55 }
        else { 0.45 }
    }).sum();
    units * height as f32 * 0.7 > width as f32 * 1.15
}

fn deduplicate_overlapping_text(mut blocks: Vec<TextBlock>) -> Vec<TextBlock> {
    // Prefer full visible text-range lines to the short control names some
    // providers expose for the very same pixels.
    blocks.sort_by_key(|b| std::cmp::Reverse(b.box_rect.width as u64 * b.box_rect.height as u64));
    let mut unique: Vec<TextBlock> = Vec::with_capacity(blocks.len());
    for block in blocks {
        let duplicate = unique.iter().any(|existing| {
            let a = existing.box_rect;
            let b = block.box_rect;
            let overlap_w = (a.x + a.width as i32).min(b.x + b.width as i32) - a.x.max(b.x);
            let overlap_h = (a.y + a.height as i32).min(b.y + b.height as i32) - a.y.max(b.y);
            let overlap = (overlap_w.max(0) as u64) * (overlap_h.max(0) as u64);
            let smaller_area = (a.width as u64 * a.height as u64)
                .min(b.width as u64 * b.height as u64)
                .max(1);
            let overlap_ratio = overlap as f64 / smaller_area as f64;
            if overlap_ratio < 0.70 {
                return false;
            }
            let a_text = normalize_text(&existing.text);
            let b_text = normalize_text(&block.text);
            a_text == b_text || (b_text.chars().count() >= 2 && a_text.contains(&b_text))
        });
        if !duplicate {
            unique.push(block);
        }
    }
    unique.sort_by_key(|b| (b.box_rect.y, b.box_rect.x));
    unique
}

fn normalize_text(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

fn text_lines_to_blocks(
    text: &str,
    rects: &[[f64; 4]],
    origin: (i32, i32),
    region: PhysicalRect,
) -> Vec<TextBlock> {
    let lines: Vec<&str> = text.lines().collect();
    if lines.is_empty() || lines.len() != rects.len() {
        return Vec::new();
    }
    lines
        .into_iter()
        .zip(rects.iter())
        .filter_map(|(line, rect)| {
            let text = line.trim_end();
            if text.trim().is_empty() || text.chars().count() > 2048 {
                return None;
            }
            let to_i32 = |v: f64| {
                if v.is_finite() {
                    v.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32
                } else {
                    0
                }
            };
            let left = to_i32(rect[0]).saturating_sub(origin.0).max(region.x);
            let top = to_i32(rect[1]).saturating_sub(origin.1).max(region.y);
            let right = to_i32(rect[0] + rect[2])
                .saturating_sub(origin.0)
                .min(region.x.saturating_add(region.width as i32));
            let bottom = to_i32(rect[1] + rect[3])
                .saturating_sub(origin.1)
                .min(region.y.saturating_add(region.height as i32));
            let width = right.saturating_sub(left);
            let height = bottom.saturating_sub(top);
            if width < 4 || height < 5 {
                return None;
            }
            Some(TextBlock {
                text: text.to_string(),
                confidence: 0.995,
                box_rect: BoundingBox {
                    x: left - region.x,
                    y: top - region.y,
                    width: width as u32,
                    height: height as u32,
                },
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(text: &str, x: i32, y: i32) -> TextBlock {
        TextBlock {
            text: text.to_string(),
            confidence: 0.99,
            box_rect: BoundingBox {
                x,
                y,
                width: 40,
                height: 16,
            },
        }
    }

    #[test]
    fn icon_button_accessible_name_is_not_assumed_to_be_visible_text() {
        assert!(is_icon_sized_accessible_name("Close", 22, 22));
        assert!(is_icon_sized_accessible_name("关闭", 22, 22));
        assert!(is_icon_sized_accessible_name("X", 22, 22));
        assert!(!is_icon_sized_accessible_name("Go", 28, 22));
        assert!(!is_icon_sized_accessible_name("Change password", 220, 40));
    }

    #[test]
    fn overlapping_duplicate_names_are_kept_once_but_distinct_labels_remain() {
        let got = deduplicate_overlapping_text(vec![
            block("File", 10, 10),
            block(" file ", 11, 11),
            block("Edit", 60, 10),
        ]);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].text, "File");
        assert_eq!(got[1].text, "Edit");
    }

    #[test]
    fn visible_text_line_wins_over_overlapping_short_control_name() {
        let got = deduplicate_overlapping_text(vec![
            TextBlock {
                text: "cargo run --release".into(),
                confidence: 0.99,
                box_rect: BoundingBox {
                    x: 10,
                    y: 10,
                    width: 200,
                    height: 20,
                },
            },
            TextBlock {
                text: "run".into(),
                confidence: 0.99,
                box_rect: BoundingBox {
                    x: 70,
                    y: 10,
                    width: 30,
                    height: 20,
                },
            },
        ]);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].text, "cargo run --release");
    }

    #[test]
    fn visible_text_lines_keep_spacing_and_map_to_their_screen_rows() {
        let region = PhysicalRect {
            x: 100,
            y: 50,
            width: 500,
            height: 180,
        };
        let got = text_lines_to_blocks(
            "cargo run --release\r\n正在重新编译",
            &[[120.0, 70.0, 210.0, 18.0], [120.0, 92.0, 150.0, 18.0]],
            (0, 0),
            region,
        );
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].text, "cargo run --release");
        assert_eq!(
            got[0].box_rect,
            BoundingBox {
                x: 20,
                y: 20,
                width: 210,
                height: 18
            }
        );
        assert_eq!(got[1].text, "正在重新编译");
        assert_eq!(got[1].box_rect.y, 42);
    }

    #[test]
    fn visible_text_lines_preserve_terminal_indentation() {
        let got = text_lines_to_blocks(
            "    cargo run --release  ",
            &[[10.0, 10.0, 200.0, 18.0]],
            (0, 0),
            PhysicalRect {
                x: 0,
                y: 0,
                width: 300,
                height: 100,
            },
        );
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].text, "    cargo run --release");
    }

    #[test]
    fn disjoint_text_fragments_combine_into_one_line_geometry() {
        assert_eq!(
            union_rectangles(&[[10.0, 20.0, 30.0, 12.0], [44.0, 20.0, 16.0, 12.0]]),
            Some([10.0, 20.0, 50.0, 12.0])
        );
        assert_eq!(union_rectangles(&[[0.0, 0.0, 0.0, 10.0]]), None);
    }

    #[test]
    fn visible_text_with_unmappable_geometry_falls_back_to_image_ocr() {
        let got = text_lines_to_blocks(
            "line one\nline two",
            &[[10.0, 10.0, 50.0, 16.0]],
            (0, 0),
            PhysicalRect {
                x: 0,
                y: 0,
                width: 100,
                height: 100,
            },
        );
        assert!(got.is_empty());
    }

    #[test]
    fn visible_text_rectangles_map_from_negative_virtual_desktop_origin() {
        let got = text_lines_to_blocks(
            "terminal text",
            &[[-900.0, -180.0, 100.0, 20.0]],
            (-1000, -200),
            PhysicalRect {
                x: 0,
                y: 0,
                width: 500,
                height: 300,
            },
        );
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].box_rect.x, 100);
        assert_eq!(got[0].box_rect.y, 20);
    }
}
