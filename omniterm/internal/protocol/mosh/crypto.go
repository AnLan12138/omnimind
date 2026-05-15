package mosh

// AES-128-OCB implementation per RFC 7253 for MOSH protocol encryption.
// MOSH uses: 12-byte nonce, 16-byte tag, no associated data.

import (
	"crypto/aes"
	"crypto/rand"
	"encoding/binary"
	"fmt"
)

// ocbEncrypt encrypts plaintext with AES-128-OCB.
// Returns nonce || ciphertext || tag (12 + len(plaintext) + 16 bytes).
func ocbEncrypt(key, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	bs := block.BlockSize() // 16

	nonce := make([]byte, 12)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}

	// Compute L = E_K(0^128)
	L := make([]byte, bs)
	zero := make([]byte, bs)
	block.Encrypt(L, zero)

	// Compute nonce-dependent offset (simplified for 12-byte nonce)
	// For 12-byte nonce: Offset = E_K(nonce || 0^31 || 0^1 || 0^31 || 1)
	nonceBlock := make([]byte, bs)
	copy(nonceBlock, nonce)
	nonceBlock[15] = 0x01 // bottom = 1 (last bit of taglen encoding)
	offset := make([]byte, bs)
	block.Encrypt(offset, nonceBlock)

	// Encrypt blocks
	ciphertext := make([]byte, len(plaintext))
	checksum := make([]byte, bs)
	n := len(plaintext)
	var i int
	for i = 0; i+bs <= n; i += bs {
		// Checksum = Checksum XOR M_i
		xorBlocks(checksum, checksum, plaintext[i:i+bs])
		// Offset = Offset XOR L·ntz(i/bs+1)
		offset = ocbUpdateOffset(offset, L, i/bs+1)
		// C_i = Offset XOR E_K(M_i XOR Offset)
		tmp := make([]byte, bs)
		xorBlocks(tmp, plaintext[i:i+bs], offset)
		block.Encrypt(tmp, tmp)
		xorBlocks(ciphertext[i:i+bs], tmp, offset)
	}

	// Handle partial final block
	if i < n {
		// Pad the final block
		pad := make([]byte, bs)
		block.Encrypt(pad, offset)
		copy(ciphertext[i:], plaintext[i:])
		for j := i; j < n; j++ {
			ciphertext[j] ^= pad[j-i]
		}
		// Checksum = Checksum XOR (M_* || 0*)
		finalBlock := make([]byte, bs)
		copy(finalBlock, plaintext[i:])
		finalBlock[len(plaintext[i:])] = 0x80 // padding
		xorBlocks(checksum, checksum, finalBlock)
	}

	// Tag = E_K(Checksum XOR Offset) [truncated to 16 bytes]
	tagOffset := ocbUpdateOffset(offset, L, i/bs+1)
	tag := make([]byte, bs)
	xorBlocks(tag, checksum, tagOffset)
	block.Encrypt(tag, tag)

	// Output: nonce || ciphertext || tag
	result := make([]byte, 12+len(ciphertext)+16)
	copy(result, nonce)
	copy(result[12:], ciphertext)
	copy(result[12+len(ciphertext):], tag)
	return result, nil
}

// ocbDecrypt decrypts data in format: nonce(12) || ciphertext || tag(16).
func ocbDecrypt(key, data []byte) ([]byte, error) {
	if len(data) < 28 { // 12 nonce + 16 tag minimum
		return nil, fmt.Errorf("mosh: data too short for OCB")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	bs := block.BlockSize()

	nonce := data[:12]
	ciphertext := data[12 : len(data)-16]
	tag := data[len(data)-16:]

	// Compute L = E_K(0^128)
	L := make([]byte, bs)
	zero := make([]byte, bs)
	block.Encrypt(L, zero)

	// Reconstruct nonce-dependent offset
	nonceBlock := make([]byte, bs)
	copy(nonceBlock, nonce)
	nonceBlock[15] = 0x01
	offset := make([]byte, bs)
	block.Encrypt(offset, nonceBlock)

	// Decrypt blocks
	plaintext := make([]byte, len(ciphertext))
	checksum := make([]byte, bs)
	n := len(ciphertext)
	var i int
	for i = 0; i+bs <= n; i += bs {
		offset = ocbUpdateOffset(offset, L, i/bs+1)
		tmp := make([]byte, bs)
		xorBlocks(tmp, ciphertext[i:i+bs], offset)
		block.Decrypt(tmp, tmp)
		xorBlocks(plaintext[i:i+bs], tmp, offset)
		xorBlocks(checksum, checksum, plaintext[i:i+bs])
	}

	// Handle partial final block
	if i < n {
		pad := make([]byte, bs)
		block.Encrypt(pad, offset)
		copy(plaintext[i:], ciphertext[i:])
		for j := i; j < n; j++ {
			plaintext[j] ^= pad[j-i]
		}
		finalBlock := make([]byte, bs)
		copy(finalBlock, plaintext[i:])
		finalBlock[len(plaintext[i:])] = 0x80
		xorBlocks(checksum, checksum, finalBlock)
	}

	// Verify tag
	tagOffset := ocbUpdateOffset(offset, L, i/bs+1)
	expectedTag := make([]byte, bs)
	xorBlocks(expectedTag, checksum, tagOffset)
	block.Encrypt(expectedTag, expectedTag)

	if !constantTimeEqual(tag, expectedTag) {
		return nil, fmt.Errorf("mosh: authentication tag mismatch")
	}

	return plaintext, nil
}

// ocbUpdateOffset: Offset = Offset XOR (L << 1) with conditional XOR 0x87
// ntz(i) = number of trailing zeros in i, for Gray code update
func ocbUpdateOffset(offset, L []byte, blockIdx int) []byte {
	// Compute L * ntz(blockIdx): double L repeatedly based on trailing zeros
	Lntz := make([]byte, len(L))
	copy(Lntz, L)

	// Find the number of trailing zeros in blockIdx
	ntz := 0
	for i := blockIdx; i&1 == 0; i >>= 1 {
		ntz++
	}

	// Double Lntz ntz times: shift left 1 bit, XOR 0x87 if MSB was set
	for i := 0; i < ntz; i++ {
		carry := Lntz[0] >> 7
		for j := 0; j < len(Lntz)-1; j++ {
			Lntz[j] = (Lntz[j] << 1) | (Lntz[j+1] >> 7)
		}
		Lntz[len(Lntz)-1] = Lntz[len(Lntz)-1] << 1
		if carry != 0 {
			Lntz[len(Lntz)-1] ^= 0x87
		}
	}

	result := make([]byte, len(offset))
	xorBlocks(result, offset, Lntz)
	return result
}

// xorBlocks XORs src into dst and stores result in dst.
func xorBlocks(dst, a, b []byte) {
	for i := 0; i < len(dst); i++ {
		dst[i] = a[i] ^ b[i]
	}
}

// constantTimeEqual compares two byte slices in constant time.
func constantTimeEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	var v byte
	for i := 0; i < len(a); i++ {
		v |= a[i] ^ b[i]
	}
	return v == 0
}

// moshEncrypt encrypts a MOSH packet: seq(8) || type(1) || payload.
// Returns the encrypted UDP packet with sequence number in the clear.
func (c *Client) ocbEncryptPacket(data []byte) ([]byte, error) {
	if len(c.key) < 16 {
		return data, nil
	}
	// MOSH UDP packet: nonce(8) || encrypted(seq+type+payload)
	// The nonce for MOSH is an 8-byte sequence number in network byte order
	encrypted, err := ocbEncrypt(c.key[:16], data)
	if err != nil {
		return nil, err
	}
	return encrypted, nil
}

// moshDecrypt decrypts a MOSH UDP packet.
func (c *Client) ocbDecryptPacket(data []byte) ([]byte, error) {
	if len(c.key) < 16 {
		return data, nil
	}
	return ocbDecrypt(c.key[:16], data)
}

// readUint64 reads a big-endian uint64 from bytes.
func readUint64(b []byte) uint64 {
	return binary.BigEndian.Uint64(b)
}
