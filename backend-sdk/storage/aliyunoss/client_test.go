package aliyunoss

import "testing"

func TestNormalizePrefix(t *testing.T) {
	for input, want := range map[string]string{"": "mm-agent/tool-plus/", "/flowcanvas\\assets/": "flowcanvas/assets/"} {
		if got := normalizePrefix(input); got != want {
			t.Fatalf("normalizePrefix(%q)=%q want %q", input, got, want)
		}
	}
}

func TestMaxAssetBytes(t *testing.T) {
	if maxAssetBytes("image") >= maxAssetBytes("video") || maxAssetBytes("audio") >= maxAssetBytes("video") {
		t.Fatal("video uploads should have the largest size allowance")
	}
}
