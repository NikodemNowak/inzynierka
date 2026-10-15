import { Sha256 } from './sha256'

describe('streaming model checksum', () => {
  // Independently generated with Python hashlib, including SHA padding edges.
  it.each([
    [0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    [3, 'ae4b3280e56e2faf83f414a6e3dabe9d5fbe18976544c05fed121accb85b53fc'],
    [55, '463eb28e72f82e0a96c0a4cc53690c571281131f672aa229e0d45ae59b598b59'],
    [56, 'da2ae4d6b36748f2a318f23e7ab1dfdf45acdc9d049bd80e59de82a60895f562'],
    [63, '29af2686fd53374a36b0846694cc342177e428d1647515f078784d69cdb9e488'],
    [64, 'fdeab9acf3710362bd2658cdc9a29e8f9c757fcf9811603a8c447cd1d9151108'],
    [65, '4bfd2c8b6f1eec7a2afeb48b934ee4b2694182027e6d0fc075074f2fabb31781'],
    [4097, 'a16560d668b843fb3be99ace41dbd18471f342bd3255a1d21204b35e43f74436'],
    [
      1048593,
      'f4bf9b8dec6e3e28b2ec33266145d244fe97a6bce1ec054ace053bab67d2ef9a',
    ],
  ] as const)(
    'matches SHA256 for %i bytes across block boundaries',
    (length, expected) => {
      const input = Uint8Array.from({ length }, (_, index) => index % 251)
      const sha = new Sha256()
      for (let offset = 0; offset < length; offset += 37)
        sha.update(input.subarray(offset, offset + 37))
      expect(sha.digestHex()).toBe(expected)
    },
  )
})
