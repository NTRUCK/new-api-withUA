package setting

import "testing"

func TestResolveModelDailyLimitMultiplierUsesRequestNumber(t *testing.T) {
	tiers := []ModelDailyLimitTier{
		{From: 1, To: 3000, Multiplier: 1},
		{From: 3001, To: 5000, Multiplier: 2},
	}

	cases := []struct {
		used int64
		want float64
	}{
		{used: 0, want: 1},
		{used: 2999, want: 1},
		{used: 3000, want: 2},
		{used: 4999, want: 2},
		{used: 5000, want: 1},
	}

	for _, tc := range cases {
		if got := ResolveModelDailyLimitMultiplier(tiers, tc.used); got != tc.want {
			t.Fatalf("used=%d: got %v, want %v", tc.used, got, tc.want)
		}
	}
}

func TestCheckDailyLimitTiers(t *testing.T) {
	valid := []ModelDailyLimitTier{
		{From: 1, To: 3000, Multiplier: 1},
		{From: 3001, To: 5000, Multiplier: 2},
	}
	if err := checkDailyLimitTiers("test/default", valid, 5000); err != nil {
		t.Fatalf("valid tiers rejected: %v", err)
	}

	overlap := []ModelDailyLimitTier{
		{From: 1, To: 3000, Multiplier: 1},
		{From: 3000, To: 5000, Multiplier: 2},
	}
	if err := checkDailyLimitTiers("test/default", overlap, 5000); err == nil {
		t.Fatal("overlapping tiers should be rejected")
	}
}
