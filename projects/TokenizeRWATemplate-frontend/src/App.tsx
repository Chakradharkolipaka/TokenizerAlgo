import { SupportedWallet, WalletId, WalletManager, WalletProvider } from '@txnlab/use-wallet-react'
import { SnackbarProvider } from 'notistack'
import { useMemo } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Home from './Home'
import Layout from './Layout'
import PortfolioPage from './PortfolioPage'
import TokenizePage from './TokenizePage'
import { getAlgodConfigFromViteEnvironment, getKmdConfigFromViteEnvironment } from './utils/network/getAlgoClientConfigs'

// Get Web3Auth client ID from environment
const web3AuthClientId = (import.meta.env.VITE_WEB3AUTH_CLIENT_ID ?? '').trim()

console.log('App.tsx: Module loading, web3AuthClientId =', web3AuthClientId ? 'SET' : 'NOT SET')
console.log('App.tsx: VITE_ALGOD_SERVER =', import.meta.env.VITE_ALGOD_SERVER)
console.log('App.tsx: VITE_ALGOD_NETWORK =', import.meta.env.VITE_ALGOD_NETWORK)

/**
 * Build supported wallets list based on env/network.
 * NOTE: Web3Auth defaults to sapphire_mainnet unless web3AuthNetwork is provided.
 */
function buildSupportedWallets(): SupportedWallet[] {
  if (import.meta.env.VITE_ALGOD_NETWORK === 'localnet') {
    const kmdConfig = getKmdConfigFromViteEnvironment()
    return [
      {
        id: WalletId.KMD,
        options: {
          baseServer: kmdConfig.server,
          token: String(kmdConfig.token),
          port: String(kmdConfig.port),
        },
      },
      { id: WalletId.LUTE },
    ]
  }

  // TestNet/MainNet wallets
  const wallets: SupportedWallet[] = [{ id: WalletId.PERA }, { id: WalletId.DEFLY }, { id: WalletId.LUTE }]

  // Only add Web3Auth if we actually have a client id
  // use-wallet v4.4.0+ includes built-in Web3Auth provider
  if (web3AuthClientId) {
    wallets.push({
      id: WalletId.WEB3AUTH,
      options: {
        clientId: web3AuthClientId,
        web3AuthNetwork: 'sapphire_devnet', // Use 'sapphire_mainnet' for production
        uiConfig: {
          appName: 'Tokenize RWA Template',
          mode: 'auto', // 'auto' | 'light' | 'dark'
        },
      },
    })
  }

  return wallets
}

export default function App() {
  console.log('App.tsx: Rendering App component')
  
  try {
    const algodConfig = getAlgodConfigFromViteEnvironment()
    console.log('App.tsx: Got algod config:', algodConfig)

    const supportedWallets = useMemo(() => buildSupportedWallets(), [])
    const walletManager = useMemo(() => {
      return new WalletManager({
        wallets: supportedWallets,
        defaultNetwork: algodConfig.network,
        networks: {
          [algodConfig.network]: {
            algod: {
              baseServer: algodConfig.server,
              port: algodConfig.port,
              token: String(algodConfig.token),
            },
          },
        },
        options: {
          resetNetwork: true,
        },
      })
    }, [algodConfig.network, algodConfig.server, algodConfig.port, algodConfig.token, supportedWallets])

    console.log('App.tsx: Ready to render')

    return (
      <SnackbarProvider maxSnack={3}>
        <WalletProvider manager={walletManager}>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Home />} />
                <Route path="/tokenize" element={<TokenizePage />} />
                <Route path="/portfolio" element={<PortfolioPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </WalletProvider>
      </SnackbarProvider>
    )
  } catch (error) {
    console.error('App.tsx: Error in App component:', error)
    return (
      <div style={{ 
        backgroundColor: '#fee2e2', 
        padding: '20px', 
        color: '#991b1b',
        fontFamily: 'monospace',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word'
      }}>
        <h1>Error Loading App</h1>
        <p>{error instanceof Error ? error.message : String(error)}</p>
        <p>{error instanceof Error ? error.stack : ''}</p>
      </div>
    )
  }
}
