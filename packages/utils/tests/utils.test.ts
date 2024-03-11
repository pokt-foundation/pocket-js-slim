import { getAddressFromPublicKey } from '../src/addr-from-pubkey'
import { publicKeyFromPrivate } from '../src/public-key-from-private'
import { stringifyObjectWithSort } from '../src/sort'

const PRIVATE_KEY =
  '1f8cbde30ef5a9db0a5a9d5eb40536fc9defc318b8581d543808b7504e0902bcb243b27bc9fbe5580457a46370ae5f03a6f6753633e51efdaf2cf534fdc26cc3'
const PUBLIC_KEY =
  'b243b27bc9fbe5580457a46370ae5f03a6f6753633e51efdaf2cf534fdc26cc3'
const ADDRESS = 'b50a6e20d3733fb89631ae32385b3c85c533c560'

describe('Utils: Adress from public key tests', () => {
  it('Gets an address from a known public key', async () => {
    const resultingAddress = await getAddressFromPublicKey(PUBLIC_KEY)
    expect(resultingAddress).toBe(ADDRESS)
  })
})

describe('Utils: Public key from private key tests', () => {
  it('Gets a public key from a known private key', async () => {
    const resultingPublicKey = publicKeyFromPrivate(PRIVATE_KEY)
    expect(resultingPublicKey).toBe(PUBLIC_KEY)
  })
})

describe('Utils: Test stringifyObjectWithSort', () => {
  it('Nested valid object', () => {
    const sorted = stringifyObjectWithSort({
      abc: [3, 2, 1],
      ab: {
        y: {
          1: 1,
          3: 3,
          2: 2,
        },
        z: '3',
        x: '1',
      },
      a: 1,
    });
    expect(sorted).toBe(
      '{"a":1,'
        + '"ab":{"x":"1",'
        + '"y":{"1":1,"2":2,"3":3},'
        + '"z":"3"},'
        + '"abc":[3,2,1]}')
  })
})
