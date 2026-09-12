import React from 'react';
import ReactDOM from 'react-dom/client';
import * as AppModule from '@design/app';

// Accept both export shapes: the contract is a named `App` export, but
// generated code sometimes arrives with only a default export. A namespace
// import (instead of a static named import) keeps one bad file from blanking
// the whole preview with a module SyntaxError.
type AppExports = {
  App?: React.ComponentType;
  default?: React.ComponentType;
};

const { App: NamedApp, default: DefaultApp } = AppModule as AppExports;
const App = NamedApp ?? DefaultApp;

if (!App) {
  throw new Error('app.tsx must export a named `App` component or a default component');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
