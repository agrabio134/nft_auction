import React from 'react';
import ReactDOM from 'react-dom/client';
import { ApolloClient, InMemoryCache, ApolloProvider } from '@apollo/client';
import { WalletProvider } from '@suiet/wallet-kit';
import { ThemeProvider } from '@mui/material/styles';
import theme from './theme';
import App from './App.jsx';
import '@suiet/wallet-kit/style.css';
import './index.css';

const client = new ApolloClient({
  uri: 'https://api.indexer.xyz/graphql',
  cache: new InMemoryCache(),
  headers: {
    'x-api-key': 'MOj0BYW.dcb1aea8f883c19721b75304d78631de',
    'x-api-user': 'lofita'
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WalletProvider autoConnect={true}>
      <ApolloProvider client={client}>
        <ThemeProvider theme={theme}>
          <App />
        </ThemeProvider>
      </ApolloProvider>
    </WalletProvider>
  </React.StrictMode>
);