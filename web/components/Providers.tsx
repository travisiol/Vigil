"use client";
import { ConnectionProvider, useWallet, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useEffect, useRef } from "react";
import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * Le wallet reste connecté d'une page à l'autre, et après un rechargement complet (retour depuis la landing, mise à jour du site) :
 * si la reconnexion silencieuse du wallet échoue, Vigil redemande une fois la connexion au wallet que tu avais choisi.
 * "Disconnect" efface ce choix : rien ne se reconnecte alors.
 */
function KeepConnected() {
  const { wallet, connected, connecting, connect } = useWallet();
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || connected || connecting || !wallet) return;
    if (wallet.readyState !== WalletReadyState.Installed && wallet.readyState !== WalletReadyState.Loadable) return;
    const t = setTimeout(() => {
      if (tried.current) return;
      tried.current = true;
      connect().catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [wallet, connected, connecting, connect]);
  return null;
}

// Les wallets (Phantom, Solflare, Backpack…) sont détectés automatiquement via Wallet Standard.
// Le navigateur ne parle jamais au RPC directement : tout passe par les routes /api (clés côté serveur).
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider endpoint="https://api.mainnet-beta.solana.com">
      <WalletProvider wallets={[]} autoConnect>
        <KeepConnected />
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
