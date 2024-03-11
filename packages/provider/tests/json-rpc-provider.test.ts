import { MockAgent, setGlobalDispatcher } from 'undici'
import { DEFAULT_URL } from './test-utils'
import { JsonRpcProvider, extractBasicAuth } from '../src/json-rpc-provider'
import { V1RpcRoutes } from '@pokt-foundation/pocketjs-abstract-provider'
import { responseSamples } from './response-samples'
import { RawTxRequest } from '@pokt-foundation/pocketjs-types'

describe('JsonRpcProvider tests', () => {
  let provider: JsonRpcProvider
  let jsonRpcMockAgent: MockAgent
  let jsonRpcMockClient
  beforeEach(() => {
    provider = new JsonRpcProvider({
      rpcUrl: DEFAULT_URL,
      dispatchers: [DEFAULT_URL],
    })
    jsonRpcMockAgent = new MockAgent()
    jsonRpcMockAgent.disableNetConnect()
    jsonRpcMockClient = jsonRpcMockAgent.get(DEFAULT_URL)
    setGlobalDispatcher(jsonRpcMockAgent)
  })

  it('Gets the balance of an account', async () => {
    jsonRpcMockClient
      .intercept({
        path: `${DEFAULT_URL}${V1RpcRoutes.QueryBalance}`,
        method: 'POST',
        body: responseSamples.balance().request,
      })
      .reply(200, responseSamples.balance().response)
    const ans = await provider.getBalance(
      'ce16bb2714f93cfb3c00b5bd4b16dc5d8ca1687a'
    )
    expect(ans.toString()).toBe(
      responseSamples.balance().response.balance.toString()
    )
    await jsonRpcMockClient.close()
  })

  it('Gets the transaction count of an account', async () => {
    jsonRpcMockClient
      .intercept({
        path: `${DEFAULT_URL}${V1RpcRoutes.QueryAccountTxs}`,
        method: 'POST',
        body: responseSamples.accountTxs().request,
      })
      .reply(200, responseSamples.accountTxs().response)
    const ans = await provider.getTransactionCount(
      'ce16bb2714f93cfb3c00b5bd4b16dc5d8ca1687a'
    )
    expect(ans).toBe(responseSamples.accountTxs().response.total_txs)
    await jsonRpcMockClient.close()
  })

  it('Gets the type of an account', async () => {
    jsonRpcMockClient
      .intercept({
        path: `${DEFAULT_URL}${V1RpcRoutes.QueryApp}`,
        method: 'POST',
        body: responseSamples.queryAppFail().request,
      })
      .reply(200, responseSamples.queryAppFail().response)
    jsonRpcMockClient
      .intercept({
        path: `${DEFAULT_URL}${V1RpcRoutes.QueryNode}`,
        method: 'POST',
        body: responseSamples.queryNodeFail().request,
      })
      .reply(200, responseSamples.queryNodeFail().response)
    const ans = await provider.getType(
      'ce16bb2714f93cfb3c00b5bd4b16dc5d8ca1687a'
    )
    expect(ans).toBe('account')
    await jsonRpcMockClient.close()
  })

  it('Gets the type of a node', async () => {
    jsonRpcMockClient
      .intercept({
        path: `${DEFAULT_URL}${V1RpcRoutes.QueryApp}`,
        method: 'POST',
        body: responseSamples.queryApp().request,
      })
      .reply(200, responseSamples.queryAppFail().response)
    jsonRpcMockClient
      .intercept({
        path: `${DEFAULT_URL}${V1RpcRoutes.QueryNode}`,
        method: 'POST',
        body: responseSamples.queryNode().request,
      })
      .reply(200, responseSamples.queryNode().response)
    const ans = await provider.getType(
      '3808c2de7d2e8eeaa2e13768feb78b10b13c8699'
    )
    expect(ans).toBe('node')
    await jsonRpcMockClient.close()
  })

  it('Sends a transaction and gets the answer correctly', async () => {
    jsonRpcMockClient
      .intercept({
        path: `${DEFAULT_URL}${V1RpcRoutes.ClientRawTx}`,
        method: 'POST',
        body: responseSamples.sendTransaction().request,
      })
      .reply(200, responseSamples.sendTransaction().response)
    const ans = await provider.sendTransaction(
      new RawTxRequest(
        '3808c2de7d2e8eeaa2e13768feb78b10b13c8699',
        'd9010a490a102f782e6e6f6465732e4d736753656e6412350a14073b1fbbf246d17bb75d270580c53fd356876d7012145f8027e4aa0b971842199998cb585a1d65b200651a0731303030303030120e0a0575706f6b74120531303030301a640a207e3acf8a3b238e193836adbb20ebd95071fabc39f5c483e0dcc508d5c770c28112404d5baec2b57ae446ce7b47704aae0d7332eded723ee95caed6d59bf34aaf873be63e5612ec34c8c0830101705858413f10cf2209237825647565e378a3462f09220d4d736753656e644a7354657374288dcf86fb89b4c303'
      )
    )
    expect(ans.txHash).toBe(
      'E18E06C9FE249394449EB508EFB696D10A48CFABD982B13407FFC6ED34243E73'
    )
  })

  it('Gets a block', async () => {
    jsonRpcMockClient
      .intercept({
        path: `${DEFAULT_URL}${V1RpcRoutes.QueryBlock}`,
        method: 'POST',
        body: responseSamples.queryBlock().request,
      })
      .reply(200, responseSamples.queryBlock().response)
    const ans = await provider.getBlock(59133)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    expect(ans.block.header.height).toBe('59133')
  })

  it('Gets a transaction', async () => {
    jsonRpcMockClient
      .intercept({
        path: `${DEFAULT_URL}${V1RpcRoutes.QueryTX}`,
        method: 'POST',
        body: responseSamples.queryTransaction().request,
      })
      .reply(200, responseSamples.queryTransaction().response)
    const ans = await provider.getTransaction(
      '2145F7E1C9017DEC6008E9C957B7448AEAB28A1719BF35DF1ADB5D08E4742586'
    )
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    expect(ans.hash).toBe(
      '2145F7E1C9017DEC6008E9C957B7448AEAB28A1719BF35DF1ADB5D08E4742586'
    )
  })

  it('Gets the current height', async () => {
    jsonRpcMockClient
      .intercept({
        path: `${DEFAULT_URL}${V1RpcRoutes.QueryHeight}`,
        method: 'POST',
        body: responseSamples.queryHeight().request,
      })
      .reply(200, responseSamples.queryHeight().response)
    const ans = await provider.getBlockNumber()
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    expect(ans).toBe(59133)
  })

  it('extractBasicAuth test', () => {
    let {urlStr, basicAuth} =
    extractBasicAuth('https://localhost:8082');
    expect(urlStr).toBe('https://localhost:8082');
    expect(basicAuth).toBeUndefined();

    // Url with a path
    ({urlStr, basicAuth} =
      extractBasicAuth('https://mainnet.rpc.grove.city/v1/12345678'));
    expect(urlStr).toBe('https://mainnet.rpc.grove.city/v1/12345678');
    expect(basicAuth).toBeUndefined();

    // Url with a path and a credential
    ({urlStr, basicAuth} =
      extractBasicAuth('https://scott:tiger@mainnet.rpc.grove.city/v1/12345678'));
    expect(urlStr).toBe('https://mainnet.rpc.grove.city/v1/12345678');
    expect(basicAuth).toBe('Basic c2NvdHQ6dGlnZXI=');
  })
})
