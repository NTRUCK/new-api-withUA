package dto

import "testing"

func TestChannelSettingsGetMaxInputTokens(t *testing.T) {
	tests := []struct {
		name     string
		setting  ChannelSettings
		group    string
		expected int
	}{
		{
			name:     "no limit configured",
			setting:  ChannelSettings{},
			group:    "default",
			expected: 0,
		},
		{
			name:     "only channel wide limit, group not listed",
			setting:  ChannelSettings{MaxInputTokens: 200000},
			group:    "default",
			expected: 200000,
		},
		{
			name: "group listed overrides channel wide limit",
			setting: ChannelSettings{
				MaxInputTokens:        200000,
				MaxInputTokensByGroup: map[string]int{"coding": 300000},
			},
			group:    "coding",
			expected: 300000,
		},
		{
			name: "group listed as 0 means unlimited for that group",
			setting: ChannelSettings{
				MaxInputTokens:        200000,
				MaxInputTokensByGroup: map[string]int{"coding": 0},
			},
			group:    "coding",
			expected: 0,
		},
		{
			name: "unlisted group falls back to channel wide limit",
			setting: ChannelSettings{
				MaxInputTokens:        200000,
				MaxInputTokensByGroup: map[string]int{"coding": 300000},
			},
			group:    "default",
			expected: 200000,
		},
		{
			name: "only group table configured, unlisted group unlimited",
			setting: ChannelSettings{
				MaxInputTokensByGroup: map[string]int{"default": 200000, "others": 150000},
			},
			group:    "coding",
			expected: 0,
		},
		{
			name: "empty group name falls back to channel wide limit",
			setting: ChannelSettings{
				MaxInputTokens:        200000,
				MaxInputTokensByGroup: map[string]int{"": 1},
			},
			group:    "",
			expected: 200000,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.setting.GetMaxInputTokens(tt.group); got != tt.expected {
				t.Fatalf("GetMaxInputTokens(%q) = %d, want %d", tt.group, got, tt.expected)
			}
		})
	}
}

func TestChannelSettingsGetMaxInputTokensNilReceiver(t *testing.T) {
	var setting *ChannelSettings
	if got := setting.GetMaxInputTokens("default"); got != 0 {
		t.Fatalf("nil receiver GetMaxInputTokens = %d, want 0", got)
	}
}
