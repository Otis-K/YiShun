package main

import (
	"fmt"
	"reflect"
	"testing"
)

func TestMergeImageReferencesPreservesMixedOrder(t *testing.T) {
	got, err := mergeImageReferences(
		[]string{"remote-0", "remote-1"},
		[]string{"local-0", "local-1"},
		[]imageReferencePosition{
			{Source: "local", Index: 0},
			{Source: "remote", Index: 0},
			{Source: "local", Index: 1},
			{Source: "remote", Index: 1},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"local-0", "remote-0", "local-1", "remote-1"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestMergeImageReferencesRejectsDuplicatePosition(t *testing.T) {
	_, err := mergeImageReferences(
		[]string{"remote-0"},
		[]string{"local-0"},
		[]imageReferencePosition{{Source: "remote", Index: 0}, {Source: "remote", Index: 0}},
	)
	if err == nil {
		t.Fatal("expected duplicate position error")
	}
}

func TestMergeImageReferencesSupportsFourteenReferences(t *testing.T) {
	remote := make([]string, maxImageReferences)
	for index := range remote {
		remote[index] = fmt.Sprintf("https://example.com/%d.png", index)
	}
	got, err := mergeImageReferences(remote, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != maxImageReferences {
		t.Fatalf("got %d references, want %d", len(got), maxImageReferences)
	}
}
