from app.services.merge import conflict_block, has_conflict_markers, merge3


def test_one_sided_and_identical_changes():
    assert merge3("a\nb\n", "a\nB\n", "a\nb\n") == ("a\nB\n", False)
    assert merge3("a\nb\n", "a\nb\n", "a\nB\n") == ("a\nB\n", False)
    assert merge3("a\nb\n", "a\nX\n", "a\nX\n") == ("a\nX\n", False)


def test_disjoint_edits_merge_cleanly():
    out, conflict = merge3("a\nb\nc\nd\n", "a\nB\nc\nd\n", "a\nb\nc\nD\n")
    assert (out, conflict) == ("a\nB\nc\nD\n", False)


def test_both_append_different_lines_keeps_both():
    assert merge3("x\n", "x\ny\n", "x\nz\n") == ("x\ny\nz\n", False)


def test_overlapping_insertions_are_deduplicated():
    assert merge3("t\n", "t\n- 3\n", "t\n- 3\n- 4\n") == ("t\n- 3\n- 4\n", False)


def test_same_line_edited_differently_conflicts_and_keeps_both():
    out, conflict = merge3("a\nb\nc\n", "a\nB1\nc\n", "a\nB2\nc\n")
    assert conflict and has_conflict_markers(out)
    assert out.startswith("a\n<<<<<<< ")
    assert "B1\n=======\nB2\n" in out and out.endswith(">>>>>>> THIẾT BỊ CỦA BẠN\nc\n")


def test_delete_vs_edit_conflicts():
    out, conflict = merge3("a\nb\nc\n", "a\nc\n", "a\nB\nc\n")
    assert conflict and "B" in out


def test_delete_one_side_edit_elsewhere_merges():
    assert merge3("a\nb\nc\nd\n", "a\nc\nd\n", "a\nb\nc\nD\n") == ("a\nc\nD\n", False)


def test_no_trailing_newline_is_preserved():
    assert merge3("x", "x\ny", "x\nz") == ("x\ny\nz", False)


def test_empty_base_with_different_content_keeps_both_without_conflict():
    out, conflict = merge3("", "hello\n", "world\n")
    assert (out, conflict) == ("hello\nworld\n", False)


def test_marker_detection_and_block():
    assert not has_conflict_markers("binh thuong\n=======\nkhong co khoi\n")
    block = conflict_block("ours", "theirs")
    assert has_conflict_markers(block) and "ours\n" in block and "theirs\n" in block
