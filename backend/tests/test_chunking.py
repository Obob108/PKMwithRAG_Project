from app.services.chunking import chunk_markdown, extract_wikilinks


def test_empty():
    assert chunk_markdown("") == []
    assert chunk_markdown("   \n\n ") == []


def test_split_by_heading_with_path():
    md = "# A\nnoi dung a\n\n## B\nnoi dung b\n\n# C\nnoi dung c"
    chunks = chunk_markdown(md)
    assert [c.heading for c in chunks] == ["A", "A > B", "C"]
    assert [c.idx for c in chunks] == [0, 1, 2]


def test_no_heading():
    chunks = chunk_markdown("Chi la mot doan van.")
    assert len(chunks) == 1 and chunks[0].heading == ""


def test_heading_inside_code_fence_ignored():
    md = "# Real\n```\n# not a heading\n```\nsau"
    chunks = chunk_markdown(md)
    assert len(chunks) == 1 and chunks[0].heading == "Real"
    assert "# not a heading" in chunks[0].text


def test_long_text_respects_max_chars():
    para = " ".join(["Day la mot cau kha dai de thu nghiem."] * 200)
    chunks = chunk_markdown(para, max_chars=500, overlap_chars=100)
    assert len(chunks) > 1
    assert all(len(c.text) <= 500 for c in chunks)


def test_hard_cut_very_long_token():
    chunks = chunk_markdown("x" * 3000, max_chars=1000)
    assert len(chunks) == 3 and all(len(c.text) <= 1000 for c in chunks)


def test_overlap_repeats_last_paragraph():
    paras = [f"doan so {i} " + "y" * 50 for i in range(10)]
    chunks = chunk_markdown("\n\n".join(paras), max_chars=200, overlap_chars=100)
    assert len(chunks) > 1
    last_of_first = chunks[0].text.split("\n\n")[-1]
    assert chunks[1].text.startswith(last_of_first)


def test_embed_text_includes_heading():
    c = chunk_markdown("# Tieu de\nnoi dung")[0]
    assert c.embed_text().startswith("Tieu de\n")


def test_wikilinks():
    text = "Xem [[RAG]] va [[Embedding|nhung vector]], [[RAG]] lai, [[Note#muc]] va [[ ]]."
    assert extract_wikilinks(text) == ["RAG", "Embedding", "Note"]
