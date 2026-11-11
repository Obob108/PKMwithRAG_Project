from app.services.pdf import pages_to_markdown


def test_pages_to_markdown_joins_lines_and_hyphens():
    pages = [["Dong mot\nnoi tiep dong hai", "Tu bi ngat dong trong-\nsuot van ban"], [], ["Trang ba"]]
    md = pages_to_markdown(pages)
    assert md.startswith("# Trang 1\n\nDong mot noi tiep dong hai\n\n")
    assert "trongsuot" in md
    assert "# Trang 2" not in md  # trang rong bi bo qua
    assert "# Trang 3\n\nTrang ba" in md


def test_empty_pdf():
    assert pages_to_markdown([]) == ""
    assert pages_to_markdown([[" \n "]]) == ""
