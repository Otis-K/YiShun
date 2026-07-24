from pathlib import Path
import tempfile

from PIL import Image

import semantic_oracles


def expect_failure(action, message):
    try:
        action()
    except AssertionError as error:
        assert message in str(error), str(error)
        return
    raise AssertionError("预期语义判定失败，但实际通过")


def main():
    with tempfile.TemporaryDirectory(prefix="toolplus-semantic-") as temporary:
        root = Path(temporary)
        clean_a = root / "clean-a.txt"
        clean_b = root / "clean-b.txt"
        dirty = root / "dirty.txt"
        clean_a.write_text("abc", encoding="utf-8")
        clean_b.write_text("def", encoding="utf-8")
        dirty.write_text("a b", encoding="utf-8")
        request = {"options": {"mode": "all"}}
        evidence = semantic_oracles.validate_text("remove-whitespace", request, [clean_a, clean_b])
        assert evidence["files"] == 2
        expect_failure(lambda: semantic_oracles.validate_text("remove-whitespace", request, [clean_a, dirty]), "仍包含空白字符")

        inputs = []
        outputs = []
        for input_index in range(2):
            source = root / f"source-{input_index}.png"
            Image.new("RGBA", (160, 100), (20 + input_index, 40, 60, 255)).save(source)
            inputs.append(str(source))
            for part_index in range(4):
                output = root / f"source-{input_index}-part-{part_index}.png"
                Image.new("RGBA", (80, 50), (20 + input_index, 40 + part_index, 60, 255)).save(output)
                outputs.append(output)
        split_request = {"inputs": inputs, "options": {"rows": "2", "cols": "2"}}
        evidence = semantic_oracles.validate_image("image-split", split_request, outputs)
        assert evidence["files"] == 8
        expect_failure(lambda: semantic_oracles.validate_image("image-split", split_request, outputs[:-1]), "切片数量 7 != 预期 8")
    print("PASS semantic-oracles batch whitespace and image-split cardinality")


if __name__ == "__main__":
    main()
