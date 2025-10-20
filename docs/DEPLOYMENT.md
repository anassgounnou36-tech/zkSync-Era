# Deployment (zkSync Era)

- Configure PRIVATE_KEY, RPCs in .env
- Deploy:

```bash
npm run deploy
```

- Assign roles on deployed contracts (admin, executor, pauser, withdrawer) using Hardhat tasks or a quick script.
- Whitelist routers/tokens via ArbitrageExecutorUpgradeable.
- Test with small amounts on testnet before mainnet.
