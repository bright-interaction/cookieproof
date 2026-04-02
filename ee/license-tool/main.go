package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

type License struct {
	Org      string   `json:"org"`
	Features []string `json:"features"`
	Expires  string   `json:"expires"`
	IssuedAt string   `json:"issued_at"`
}

type SignedLicense struct {
	License   string `json:"license"`
	Signature string `json:"signature"`
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "Usage:\n")
		fmt.Fprintf(os.Stderr, "  license-tool keygen                          Generate keypair\n")
		fmt.Fprintf(os.Stderr, "  license-tool sign  --org NAME [--expires DATE] [--key PATH]\n")
		fmt.Fprintf(os.Stderr, "  license-tool verify KEY [--pub PATH]         Verify a license key\n")
		os.Exit(1)
	}

	switch os.Args[1] {
	case "keygen":
		cmdKeygen()
	case "sign":
		cmdSign()
	case "verify":
		cmdVerify()
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", os.Args[1])
		os.Exit(1)
	}
}

func cmdKeygen() {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error generating keypair: %v\n", err)
		os.Exit(1)
	}

	privB64 := base64.StdEncoding.EncodeToString(priv.Seed())
	pubB64 := base64.StdEncoding.EncodeToString(pub)

	if err := os.WriteFile("license.key", []byte(privB64), 0600); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing private key: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile("license.pub", []byte(pubB64), 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing public key: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Generated keypair:")
	fmt.Println("  Private: license.key (keep secret!)")
	fmt.Println("  Public:  license.pub")
	fmt.Println()
	fmt.Println("Public key (embed in server.ts):")
	fmt.Println(pubB64)
}

func cmdSign() {
	org := ""
	expires := time.Now().AddDate(1, 0, 0).Format("2006-01-02")
	keyPath := "license.key"

	for i := 2; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "--org":
			i++
			org = os.Args[i]
		case "--expires":
			i++
			expires = os.Args[i]
		case "--key":
			i++
			keyPath = os.Args[i]
		}
	}

	if org == "" {
		fmt.Fprintf(os.Stderr, "Error: --org is required\n")
		os.Exit(1)
	}

	// Validate expires date
	if _, err := time.Parse("2006-01-02", expires); err != nil {
		fmt.Fprintf(os.Stderr, "Error: --expires must be YYYY-MM-DD, got %q\n", expires)
		os.Exit(1)
	}

	// Read private key
	seedB64, err := os.ReadFile(keyPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading private key %s: %v\n", keyPath, err)
		os.Exit(1)
	}

	seed, err := base64.StdEncoding.DecodeString(string(seedB64))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error decoding private key: %v\n", err)
		os.Exit(1)
	}

	priv := ed25519.NewKeyFromSeed(seed)

	// Build license payload
	lic := License{
		Org:      org,
		Features: []string{"agency", "billing", "admin", "team", "smtp", "reports", "custom-domains"},
		Expires:  expires,
		IssuedAt: time.Now().UTC().Format(time.RFC3339),
	}

	licJSON, err := json.Marshal(lic)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error marshaling license: %v\n", err)
		os.Exit(1)
	}

	licB64 := base64.StdEncoding.EncodeToString(licJSON)
	sig := ed25519.Sign(priv, licJSON)
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	signed := SignedLicense{
		License:   licB64,
		Signature: sigB64,
	}

	signedJSON, _ := json.Marshal(signed)
	key := base64.StdEncoding.EncodeToString(signedJSON)

	fmt.Println("License key for:", org)
	fmt.Println("Expires:", expires)
	fmt.Println()
	fmt.Println("COOKIEPROOF_LICENSE_KEY=" + key)
}

func cmdVerify() {
	if len(os.Args) < 3 {
		fmt.Fprintf(os.Stderr, "Usage: license-tool verify KEY [--pub PATH]\n")
		os.Exit(1)
	}

	key := os.Args[2]
	pubPath := "license.pub"

	for i := 3; i < len(os.Args); i++ {
		if os.Args[i] == "--pub" {
			i++
			pubPath = os.Args[i]
		}
	}

	// Read public key
	pubB64, err := os.ReadFile(pubPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading public key: %v\n", err)
		os.Exit(1)
	}

	pubBytes, err := base64.StdEncoding.DecodeString(string(pubB64))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error decoding public key: %v\n", err)
		os.Exit(1)
	}

	pub := ed25519.PublicKey(pubBytes)

	// Decode the key
	signedJSON, err := base64.StdEncoding.DecodeString(key)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Invalid license key format\n")
		os.Exit(1)
	}

	var signed SignedLicense
	if err := json.Unmarshal(signedJSON, &signed); err != nil {
		fmt.Fprintf(os.Stderr, "Invalid license key structure\n")
		os.Exit(1)
	}

	licJSON, err := base64.StdEncoding.DecodeString(signed.License)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Invalid license payload\n")
		os.Exit(1)
	}

	sigBytes, err := base64.StdEncoding.DecodeString(signed.Signature)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Invalid signature\n")
		os.Exit(1)
	}

	if !ed25519.Verify(pub, licJSON, sigBytes) {
		fmt.Println("INVALID: Signature verification failed")
		os.Exit(1)
	}

	var lic License
	if err := json.Unmarshal(licJSON, &lic); err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing license data: %v\n", err)
		os.Exit(1)
	}

	expiry, _ := time.Parse("2006-01-02", lic.Expires)
	expired := time.Now().After(expiry)

	fmt.Println("VALID license:")
	fmt.Printf("  Org:      %s\n", lic.Org)
	fmt.Printf("  Features: %v\n", lic.Features)
	fmt.Printf("  Issued:   %s\n", lic.IssuedAt)
	fmt.Printf("  Expires:  %s\n", lic.Expires)
	if expired {
		fmt.Println("  Status:   EXPIRED")
		os.Exit(1)
	}
	fmt.Println("  Status:   Active")
}
