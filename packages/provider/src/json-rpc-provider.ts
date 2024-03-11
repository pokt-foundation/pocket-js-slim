import AbortController from 'abort-controller'
import debug from 'debug'
import { Buffer } from 'buffer'
import { fetch, Response } from 'undici'
import {
  Account,
  AccountWithTransactions,
  App,
  Block,
  DispatchRequest,
  DispatchResponse,
  GetAccountWithTransactionsOptions,
  GetAppsOptions,
  GetBlockTransactionsOptions,
  GetNodeClaimsOptions,
  GetNodesOptions,
  GetPaginableOptions,
  Node,
  Paginable,
  PaginableBlockTransactions,
  RawTransactionResponse,
  RawTxRequest,
  SessionHeader,
  Transaction,
  TransactionResponse,
} from '@pokt-foundation/pocketjs-types'
import {
  AbstractProvider,
  DispatchersFailureError,
  RelayFailureError,
  TimeoutError,
  validateTransactionResponse,
  V1RpcRoutes,
} from '@pokt-foundation/pocketjs-abstract-provider'

const DEFAULT_TIMEOUT = 10000

/**
 * ExtractBasicAuth extracts basic authentication credentials from the given
 * url into a separate base64-encoded string so that we can pass it to Fetch API.
 **/
export function ExtractBasicAuth(urlStr: string) {
  const url = new URL(urlStr);
  if (!url.username && !url.password) {
    return {
      urlStr,
    };
  }

  const credential =
    Buffer.from(`${url.username}:${url.password}`).toString('base64');
  url.username = '';
  url.password = '';
  return {
    urlStr: url.toString(),
    basicAuth: `Basic ${credential}`,
  };
}

/**
 * A JSONRPCProvider lets you query data from the chain and send relays to the network.
 * NodeJS only, not Isomorphic or Browser compatible.
 *  **/
export class JsonRpcProvider implements AbstractProvider {
  private rpcUrl: string
  private dispatchers: string[]
  private logger

  constructor({
    rpcUrl = '',
    dispatchers = [],
  }: {
    rpcUrl: string
    dispatchers?: string[]
  }) {
    this.rpcUrl = rpcUrl
    this.dispatchers = dispatchers ?? []
    this.logger = debug('JsonRpcProvider')
  }

  private async perform({
    route,
    body,
    rpcUrl,
    timeout = DEFAULT_TIMEOUT,
    retryAttempts = 0,
    retriesPerformed = 0,
  }: {
    route: V1RpcRoutes
    body: any
    rpcUrl?: string
    timeout?: number
    retryAttempts?: number
    retriesPerformed?: number
  }): Promise<Response> {
    const startTime = process.hrtime()
    const shouldRetryOnFailure = retriesPerformed < retryAttempts
    const performRetry = () =>
      this.perform({
        route,
        body,
        rpcUrl,
        timeout,
        retryAttempts,
        retriesPerformed: retriesPerformed + 1,
      })

    const controller = new AbortController()
    setTimeout(() => controller.abort(), timeout)

    const finalRpcUrl = rpcUrl
      ? rpcUrl
      : route === V1RpcRoutes.ClientDispatch
      ? this.dispatchers[
          Math.floor(Math.random() * 100) % this.dispatchers.length
        ]
      : this.rpcUrl

    const headers = {
      'Content-Type': 'application/json',
    };

    const {urlStr, basicAuth} = ExtractBasicAuth(finalRpcUrl);
    if (basicAuth) {
      headers['Authorization'] = basicAuth;
    }

    const routedRpcUrl = urlStr + route;

    const rpcResponse = await fetch(routedRpcUrl, {
      method: 'POST',
      signal: controller.signal as AbortSignal,
      headers: headers,
      body: JSON.stringify(body),
    }).catch((error) => {
      debug(`${routedRpcUrl} attempt ${retriesPerformed + 1} failure`)
      if (shouldRetryOnFailure) {
        return performRetry()
      } else {
        debug(`${routedRpcUrl} total failure`)
        throw error
      }
    })

    const totalTime = process.hrtime(startTime)
    debug(
      `${routedRpcUrl} (attempt ${
        retriesPerformed + 1
      }) CALL DURATION: ${totalTime}`
    )

    // Fetch can fail by either throwing due to a network error or responding with
    // ok === false on 40x/50x so both situations be explicitly handled separately.
    return !rpcResponse.ok && shouldRetryOnFailure
      ? performRetry()
      : rpcResponse
  }

  /**
   * Fetches the provided address's balance.
   * @param {string} address - The address to query.
   * @returns {bigint} - The address's balance.
   * */
  async getBalance(address: string | Promise<string>): Promise<bigint> {
    const res = await this.perform({
      route: V1RpcRoutes.QueryBalance,
      body: { address: await address },
    })
    const { balance } = (await res.json()) as { balance: number }
    return BigInt(balance.toString())
  }

  /**
   * Fetches the provided address's transaction count.
   * @param {string} address - The address to query.
   * @returns {number} - The address's transaction count.
   * */
  async getTransactionCount(
    address: string | Promise<string>
  ): Promise<number> {
    const txsRes = await this.perform({
      route: V1RpcRoutes.QueryAccountTxs,
      body: { address: await address },
    })
    const txs = (await txsRes.json()) as any

    if (!('total_txs' in txs)) {
      throw new Error('RPC Error')
    }

    const { total_txs } = txs

    return total_txs
  }

  /**
   * Gets the address's acount type (node, app, or account).
   * @param {string} address - The address to query.
   * @returns {'node' | 'app' | 'account'} - The address's account type.
   * */
  async getType(
    address: string | Promise<string>
  ): Promise<'node' | 'app' | 'account'> {
    const appRes = await this.perform({
      route: V1RpcRoutes.QueryApp,
      body: { address: await address },
    })
    const nodeRes = await this.perform({
      route: V1RpcRoutes.QueryNode,
      body: { address: await address },
    })
    const node = (await nodeRes.json()) as any
    const app = (await appRes.json()) as any

    if (!('service_url' in node) && 'max_relays' in app) {
      return 'app'
    }

    if ('service_url' in node && !('max_relays' in app)) {
      return 'node'
    }

    return 'account'
  }

  /**
   * Sends a signed transaction from this provider.
   * @param {TransactionRequest} transaction - The transaction to send, formatted as a `TransactionRequest`.
   * @returns {TransactionResponse} - The network's response to the transaction.
   * */
  async sendTransaction(
    transaction: RawTxRequest
  ): Promise<TransactionResponse> {
    const res = await this.perform({
      route: V1RpcRoutes.ClientRawTx,
      body: { ...transaction.toJSON() },
    })

    const transactionResponse = (await res.json()) as RawTransactionResponse

    return validateTransactionResponse(transactionResponse)
  }

  /**
   * Gets an specific block by its block number.
   * @param {number} blockNumber - the number (height) of the block to query.
   * @returns {Block} - The block requested.
   * */
  async getBlock(blockNumber: number): Promise<Block> {
    const res = await this.perform({
      route: V1RpcRoutes.QueryBlock,
      body: { height: blockNumber },
    })

    const block = (await res.json()) as Block

    if (!('block' in block)) {
      throw new Error('RPC Error')
    }

    return block
  }

  /**
   * Gets an specific transaction specified by its hash.
   * @param {string} transactionHash - the hash of the transaction to get.
   * @returns {TransactionResponse} - The transaction requested.
   * */
  async getTransaction(transactionHash: string): Promise<Transaction> {
    const res = await this.perform({
      route: V1RpcRoutes.QueryTX,
      body: { hash: transactionHash },
    })

    const tx = (await res.json()) as Transaction

    if (!('hash' in tx)) {
      throw new Error('RPC Error')
    }

    return tx
  }

  /**
   * Fetches the latest block number.
   * @returns {number} - The latest height as observed by the node the Provider is connected to.
   * */
  async getBlockNumber(): Promise<number> {
    const res = await this.perform({
      route: V1RpcRoutes.QueryHeight,
      body: {},
    })

    const { height } = (await res.json()) as { height: number }

    if (!height) {
      throw new Error('RPC Error')
    }

    return height
  }

  /**
   * Fetches the requested block's transactions.
   * @param {GetBlockTransactionsOptions} GetBlockTransactionsOptions - The options to pass in to the query.
   * @ returns {PaginableBlockTransactions} - The block's transactions.
   * */
  async getBlockTransactions(
    GetBlockTransactionsOptions: GetBlockTransactionsOptions = {
      blockHeight: 0,
      page: 1,
      perPage: 100,
      includeProofs: false,
    }
  ): Promise<PaginableBlockTransactions> {
    const {
      blockHeight: height,
      includeProofs,
      page,
      perPage,
    } = GetBlockTransactionsOptions
    const res = await this.perform({
      route: V1RpcRoutes.QueryBlockTxs,
      body: {
        height,
        prove: includeProofs,
        page,
        perPage,
      },
    })

    const blockTxs = (await res.json()) as any

    if (!('txs' in blockTxs)) {
      throw new Error('RPC Error')
    }

    return {
      pageCount: blockTxs.page_count,
      totalTxs: blockTxs.total_txs,
      txs: blockTxs.txs,
    } as PaginableBlockTransactions
  }

  /**
   * Fetches nodes active from the network with the options provided.
   * @param {GetNodesOptions} getNodesOptions - the options to pass in to the query.
   * @returns {Node[]} - An array with the nodes requested and their information.
   * */
  async getNodes(
    GetNodesOptions: GetNodesOptions = {
      blockHeight: 0,
      page: 1,
      perPage: 100,
    }
  ): Promise<Paginable<Node>> {
    const { blockHeight: height } = GetNodesOptions

    const res = await this.perform({
      route: V1RpcRoutes.QueryApps,
      body: {
        height,
        opts: {
          page: GetNodesOptions.page ?? 1,
          per_page: GetNodesOptions.perPage ?? 100,
          ...(GetNodesOptions?.blockchain
            ? { blockchain: GetNodesOptions.blockchain }
            : {}),
          ...(GetNodesOptions?.stakingStatus
            ? { staking_status: GetNodesOptions.stakingStatus }
            : {}),
          ...(GetNodesOptions?.jailedStatus
            ? { jailed_status: GetNodesOptions.jailedStatus }
            : {}),
        },
      },
      ...(GetNodesOptions?.timeout ? { timeout: GetNodesOptions.timeout } : {}),
    })

    const parsedRes = (await res.json()) as any

    if (!('result' in parsedRes)) {
      throw new Error('Failed to get apps')
    }

    const nodes = parsedRes.result.map((node) => {
      const {
        address,
        chains,
        jailed,
        public_key,
        staked_tokens,
        status,
        service_url,
      } = node

      return {
        address,
        chains,
        publicKey: public_key,
        jailed,
        stakedTokens: staked_tokens ?? '0',
        status,
        serviceUrl: service_url,
      } as Node
    })

    return {
      data: nodes,
      page: GetNodesOptions.page,
      perPage: GetNodesOptions.perPage,
      totalPages: parsedRes.total_pages,
    } as Paginable<Node>
  }

  /**
   * Fetches a node from the network with the options provided.
   * @param {string} address - The address corresponding to the node.
   * @param {GetNodesOptions} getNodesOptions - The options to pass in to the query.
   * @returns {Node} - The node requested and its information.
   * */
  async getNode({
    address,
    blockHeight,
  }: {
    address: string | Promise<string>
    blockHeight?: number
  }): Promise<Node> {
    const res = await this.perform({
      route: V1RpcRoutes.QueryNode,
      body: {
        address: await address,
        ...(blockHeight ? { height: blockHeight } : {}),
      },
    })
    const node = (await res.json()) as any

    if (!('chains' in node)) {
      throw new Error('RPC Error')
    }

    const {
      chains,
      jailed,
      public_key,
      service_url,
      status,
      tokens,
      unstaking_time,
    } = node

    return {
      address: await address,
      chains,
      publicKey: public_key,
      jailed,
      serviceUrl: service_url,
      stakedTokens: tokens.toString(),
      status,
      unstakingTime: unstaking_time,
    } as Node
  }

  /**
   * Fetches apps from the network with the options provided.
   * @param {GetAppOptions} getAppOptions - The options to pass in to the query.
   * @returns {App} - An array with the apps requested and their information.
   * */
  async getApps(
    GetAppsOptions: GetAppsOptions = {
      blockHeight: 0,
      page: 1,
      perPage: 100,
    }
  ): Promise<Paginable<App>> {
    const { blockHeight: height } = GetAppsOptions

    const res = await this.perform({
      route: V1RpcRoutes.QueryApps,
      body: {
        height,
        opts: {
          page: GetAppsOptions.page ?? 1,
          per_page: GetAppsOptions.perPage ?? 100,
          ...(GetAppsOptions?.stakingStatus
            ? { staking_status: GetAppsOptions.stakingStatus }
            : {}),
          ...(GetAppsOptions?.blockchain
            ? { blockchain: GetAppsOptions.blockchain }
            : {}),
        },
      },
      ...(GetAppsOptions?.timeout ? { timeout: GetAppsOptions.timeout } : {}),
    })

    const parsedRes = (await res.json()) as any

    if (!('result' in parsedRes)) {
      throw new Error('Failed to get apps')
    }

    const apps = parsedRes.result.map((app) => {
      const {
        address,
        chains,
        jailed,
        max_relays,
        public_key,
        staked_tokens,
        status,
      } = app

      return {
        address,
        chains,
        publicKey: public_key,
        jailed,
        maxRelays: max_relays ?? '',
        stakedTokens: staked_tokens ?? '0',
        status,
      } as App
    })

    return {
      data: apps,
      page: GetAppsOptions.page,
      perPage: GetAppsOptions.perPage,
      totalPages: parsedRes.total_pages,
    } as Paginable<App>
  }

  /**
   * Fetches an app from the network with the options provided.
   * @param {string} address - The address of the app to fetch.
   * @param {GetAppOptions} getAppOptions - The options to pass in to the query.
   * @returns {App} - The app requested and its information.
   * */
  async getApp({
    address,
    blockHeight,
  }: {
    address: string | Promise<string>
    blockHeight?: number
  }): Promise<App> {
    const res = await this.perform({
      route: V1RpcRoutes.QueryApp,
      body: {
        address: await address,
        ...(blockHeight ? { height: blockHeight } : {}),
      },
    })

    const app = (await res.json()) as any

    if (!('chains' in app)) {
      throw new Error('RPC Error')
    }

    const { chains, jailed, max_relays, public_key, staked_tokens, status } =
      app

    return {
      address: await address,
      chains,
      publicKey: public_key,
      jailed,
      maxRelays: max_relays ?? '',
      stakedTokens: staked_tokens ?? '0',
      status,
    } as App
  }

  /**
   * Fetches an account from the network.
   * @param {string} address - The address of the account to fetch.
   * @returns {Account} - The account requested and its information.
   * */
  async getAccount(address: string | Promise<string>): Promise<Account> {
    const res = await this.perform({
      route: V1RpcRoutes.QueryAccount,
      body: { address: await address },
    })
    const account = (await res.json()) as any

    if (!('address' in account)) {
      throw new Error('RPC Error')
    }

    const { coins, public_key } = account

    return {
      address: await address,
      balance: coins[0]?.amount ?? 0,
      publicKey: public_key,
    }
  }

  /**
   * Fetches an account from the network, along with its transactions.
   * @param {string} address - The address of the account to fetch.
   * @returns {AccountWithTransaction} - The account requested and its information, along with its transactions.
   * */
  async getAccountWithTransactions(
    address: string | Promise<string>,
    options: GetAccountWithTransactionsOptions = {
      page: 1,
      perPage: 100,
    }
  ): Promise<AccountWithTransactions> {
    const accountRes = await this.perform({
      route: V1RpcRoutes.QueryAccount,
      body: { address: await address },
    })
    const txsRes = await this.perform({
      route: V1RpcRoutes.QueryAccountTxs,
      body: { address: await address, ...options },
    })
    const account = (await accountRes.json()) as any
    const txs = (await txsRes.json()) as any

    if (!('address' in account)) {
      throw new Error('RPC Error')
    }
    if (!('total_count' in txs)) {
      throw new Error('RPC Error')
    }

    const { coins, public_key } = account
    const { total_txs, txs: transactions } = txs

    return {
      address: await address,
      balance: coins[0]?.amount ?? 0,
      publicKey: public_key,
      totalCount: total_txs,
      transactions: transactions,
    }
  }

  /**
   * Performs a dispatch request to a random dispatcher from the ones provided. Fails if no dispatcher is found.
   * @param {DispatchRequest} request - The dispatch request.
   * @param {object} options - The options available to tweak the request itself.
   * @param {number} options.retryAttempts - The number of retries to perform if the first call fails.
   * @param {boolean} options.rejectSelfSignedCertificates - Option to reject self signed certificates or not.
   * @param {timeout} options.timeout - Timeout before the call fails. In milliseconds.
   * @returns {DispatchResponse} - The dispatch response from the dispatcher node.
   * */
  async dispatch(
    request: DispatchRequest,
    options: {
      retryAttempts?: number
      rejectSelfSignedCertificates?: boolean
      timeout?: number
    } = {
      retryAttempts: 0,
      rejectSelfSignedCertificates: false,
    }
  ): Promise<DispatchResponse> {
    if (!this.dispatchers.length) {
      throw new Error('You need to have dispatchers to perform a dispatch call')
    }

    try {
      const dispatchRes = await this.perform({
        route: V1RpcRoutes.ClientDispatch,
        body: {
          app_public_key: request.sessionHeader.applicationPubKey,
          chain: request.sessionHeader.chain,
          session_height: request.sessionHeader.sessionBlockHeight,
        },
        ...options,
      })

      const dispatch = (await dispatchRes.json()) as any

      if (!('session' in dispatch)) {
        throw new Error('RPC Error')
      }

      const { block_height: blockHeight, session } = dispatch

      const { header, key, nodes } = session
      const formattedNodes: Node[] = nodes.map((node) => {
        const {
          address,
          chains,
          jailed,
          public_key,
          service_url,
          status,
          tokens,
          unstaking_time,
        } = node

        return {
          address,
          chains,
          publicKey: public_key,
          jailed,
          serviceUrl: service_url,
          stakedTokens: tokens.toString(),
          status,
          unstakingTime: unstaking_time,
        } as Node
      })

      const formattedHeader: SessionHeader = {
        applicationPubKey: header.app_public_key,
        chain: header.chain,
        sessionBlockHeight: header.session_height,
      }

      return {
        blockHeight,
        session: {
          blockHeight,
          header: formattedHeader,
          key,
          nodes: formattedNodes,
        },
      }
    } catch (err: any) {
      this.logger(JSON.stringify(err, Object.getOwnPropertyNames(err)))
      if (err.name === 'AbortError') {
        throw new TimeoutError()
      }
      throw new DispatchersFailureError()
    }
  }

  /**
   * Sends a relay to the network through the main RPC URL provided. Best used through a Relayer.
   * @param {any} request - The relay request.
   * @param {string} rpcUrl - The RPC URL to use, if the main RPC URL is not a suitable node to relay requests.
   * @param {object} options - The options available to tweak the request itself.
   * @param {number} options.retryAttempts - The number of retries to perform if the first call fails.
   * @param {boolean} options.rejectSelfSignedCertificates - Option to reject self signed certificates or not.
   * @param {timeout} options.timeout - Timeout before the call fails. In milliseconds.
   * @returns {any} - A relay response.
   * * */
  async relay(
    request,
    rpcUrl: string,
    options: {
      retryAttempts?: number
      rejectSelfSignedCertificates?: boolean
      timeout?: number
    } = {
      retryAttempts: 0,
      rejectSelfSignedCertificates: false,
    }
  ): Promise<unknown> {
    try {
      const relayAttempt = await this.perform({
        route: V1RpcRoutes.ClientRelay,
        body: request,
        rpcUrl,
        ...options,
      })

      const relayResponse = await relayAttempt.json()
      this.logger(JSON.stringify(relayResponse))

      return relayResponse
    } catch (err: any) {
      this.logger(
        `ERROR: ${JSON.stringify(err, Object.getOwnPropertyNames(err))}`
      )
      if (err.name === 'AbortError') {
        throw new TimeoutError()
      }
      throw new RelayFailureError()
    }
  }

  /**
   * Gets all the parameters used to configure the Pocket Network.
   * @param {number} height - The block height to use to determine the params.
   * @param {object} options - The options available to tweak the request itself.
   * @param {number} options.timeout - Timeout before the call fails. In milliseconds.
   * @returns {any} - The raw params.
   * * */
  public async getAllParams(
    height: number,
    options: {
      timeout?: number
    }
  ): Promise<any> {
    if (height < 0) {
      throw new Error('Invalid height input')
    }

    try {
      const res = await this.perform({
        route: V1RpcRoutes.QueryAllParams,
        body: { height },
        ...options,
      })

      const params = await res.json()
      this.logger(JSON.stringify(params))

      return params
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new TimeoutError()
      }
      throw err
    }
  }

  /**
   * Gets the corresponding node's claims.
   * @param {string} address - The address of the node to get the claims from.
   * @param {object} GetNodeClaimsOptions - The options available to tweak the request itself.
   * @param {number} options.height - The block height to use to determine the result of the call.
   * @param {number} options.page - The page to get the node claims from.
   * @param {number} options.perPage - How many claims per page to retrieve.
   * @param {timeout} options.timeout - Timeout before the call fails. In milliseconds.
   * @returns {any} - The raw node claims.
   * * */
  public async getNodeClaims(
    address: string,
    options: GetNodeClaimsOptions
  ): Promise<Paginable<any>> {
    try {
      const res = await this.perform({
        route: V1RpcRoutes.QueryNodeClaims,
        body: {
          address,
          ...(options.height ? { height: options.height } : {}),
          ...(options.page ? { page: options.page } : {}),
          ...(options.perPage ? { per_page: options.perPage } : {}),
        },
        ...options,
      })

      const nodeClaims = (await res.json()) as any
      this.logger(JSON.stringify(nodeClaims))

      if (!('result' in nodeClaims)) {
        throw new Error('RPC Error')
      }

      return {
        data: nodeClaims.result,
        page: nodeClaims.page,
        totalPages: nodeClaims.total_pages,
        perPage: options?.perPage ?? 100,
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new TimeoutError()
      }
      throw err
    }
  }

  /**
   * Gets the requested supply information.
   * @param {number} height - The block height to use to determine the current supply.
   * @param {object} options - The options available to tweak the request itself.
   * @param {number} options.timeout - Timeout before the call fails. In milliseconds.
   * @returns {any} - The raw supply info.
   * * */
  public async getSupply(
    height: number = 0,
    options: {
      timeout?: number
    }
  ): Promise<any> {
    if (height < 0) {
      throw new Error('Invalid height input')
    }

    try {
      const res = await this.perform({
        route: V1RpcRoutes.QuerySupply,
        body: { height },
        ...options,
      })

      const supply = await res.json()
      this.logger(JSON.stringify(supply))

      return supply
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new TimeoutError()
      }
      throw err
    }
  }

  /**
   * Gets the supported chains.
   * @param {number} height - The block height to use to determine the supported chains at that point in time.
   * @param {object} options - The options available to tweak the request itself.
   * @param {number} options.timeout - Timeout before the call fails. In milliseconds.
   * @returns {any} - The currently supported chains.
   * * */
  public async getSupportedChains(
    height: number = 0,
    options: {
      timeout?: number
    }
  ): Promise<any> {
    if (height < 0) {
      throw new Error('Invalid height input')
    }

    try {
      const res = await this.perform({
        route: V1RpcRoutes.QuerySupportedChains,
        body: { height },
        ...options,
      })

      const supportedChains = await res.json()
      this.logger(JSON.stringify(supportedChains))

      return supportedChains
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new TimeoutError()
      }
      throw err
    }
  }

  /**
   * Gets the current Pocket Network Params.
   * @param {number} height - The block height to use to determine the Pocket Params at that point in time.
   * @param {object} options - The options available to tweak the request itself.
   * @param {number} options.timeout - Timeout before the call fails. In milliseconds.
   * @returns {any} - The raw pocket params.
   * * */
  public async getPocketParams(
    height: number = 0,
    options: {
      timeout?: number
    }
  ): Promise<any> {
    if (height < 0) {
      throw new Error('Invalid height input')
    }

    try {
      const res = await this.perform({
        route: V1RpcRoutes.QueryPocketParams,
        body: { height },
        ...options,
      })

      const pocketParams = await res.json()
      this.logger(JSON.stringify(pocketParams))

      return pocketParams
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new TimeoutError()
      }
      throw err
    }
  }

  /**
   * Gets the current Application Params.
   * @param {number} height - The block height to use to determine the Application Params at that point in time.
   * @param {object} options - The options available to tweak the request itself.
   * @param {number} options.timeout - Timeout before the call fails. In milliseconds.
   * @returns {any} - The raw application params.
   * * */
  public async getAppParams(
    height: number = 0,
    options: {
      timeout?: number
    }
  ): Promise<any> {
    if (height < 0) {
      throw new Error('Invalid height input')
    }

    try {
      const res = await this.perform({
        route: V1RpcRoutes.QueryAppParams,
        body: { height },
        ...options,
      })

      const appParams = await res.json()
      this.logger(JSON.stringify(appParams))

      return appParams
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new TimeoutError()
      }
      throw err
    }
  }
}
