package controller

import "testing"

func TestNormalizeViolationReason(t *testing.T) {
	tests := []struct {
		name     string
		code     string
		text     string
		wantText string
		wantErr  bool
	}{
		{name: "fixed tavo reason", code: "tavo_client", text: "ignored", wantText: "TAVO 客户端"},
		{name: "trim custom reason", code: "custom", text: "  repeated abuse  ", wantText: "repeated abuse"},
		{name: "reject empty custom", code: "custom", text: "  ", wantErr: true},
		{name: "strip control characters", code: "custom", text: "bad\nreason", wantText: "badreason"},
		{name: "reject unknown code", code: "other", text: "reason", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, gotText, err := normalizeViolationReason(tt.code, tt.text)
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
			if gotText != tt.wantText {
				t.Fatalf("text = %q, want %q", gotText, tt.wantText)
			}
		})
	}
}
