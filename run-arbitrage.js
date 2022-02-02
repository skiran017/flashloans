require('dotenv').config();
const Web3 = require('web3');
const { ChainId, Token, TokenAmount, Pair } = require('@uniswap/sdk'); //version ^2.0.5
const abis = require('./abis');
const { mainnet: addresses } = require('./addresses');

const web3 = new Web3(
  new Web3.providers.WebsocketProvider(process.env.INFURA_URL)
);

//fro web3 to sign Transactions
web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY);

//connect to kyber
const kyber = new web3.eth.Contract(
  abis.kyber.kyberNetworkProxy,
  addresses.kyber.kyberNetworkProxy
);

const AMOUNT_ETH = 100;
const RECENT_ETH_PRICE = 2787; //MUST make this change automatically bsed on market, for now to make things simple hardcoded
const AMOUNT_ETH_WEI = web3.utils.toWei(AMOUNT_ETH.toString()); //1ETH = 10^18 wei; for arbitrage better the smallest value
const AMOUNT_DAI_WEI = web3.utils.toWei(
  (AMOUNT_ETH * RECENT_ETH_PRICE).toString()
);

const init = async function () {
  // const [dai, weth] = await Promise.all(
  //   [addresses.tokens.dai, addresses.tokens.weth].map((tokenAddress) =>
  //     Token.fetchData(ChainId.MAINNET, tokenAddress)
  //   )
  // );
  const [dai, weth] = await Promise.all(
    [addresses.tokens.dai, addresses.tokens.weth].map((tokenAddress) =>
      Token.fetchData(ChainId.MAINNET, tokenAddress)
    )
  );
  const daiWeth = await Pair.fetchData(dai, weth);

  //to log the latest block from eth blockchain
  web3.eth
    .subscribe('newBlockHeaders')
    .on('data', async (block) => {
      console.log(`New Block received. Block # ${block.number}`);

      const kyberResults = await Promise.all([
        kyber.methods
          .getExpectedRate(
            addresses.tokens.dai,
            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            AMOUNT_DAI_WEI
          )
          .call(),
        kyber.methods
          .getExpectedRate(
            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            addresses.tokens.dai,
            AMOUNT_ETH_WEI
          )
          .call(),
      ]);
      //price normalization
      const kyberRates = {
        buy: parseFloat(1 / (kyberResults[0].expectedRate / 10 ** 18)),
        sell: parseFloat(kyberResults[1].expectedRate / 10 ** 18),
      };
      console.log('Kyber ETH/DAI');
      console.log(kyberRates);

      const uniswapResults = await Promise.all([
        daiWeth.getOutputAmount(new TokenAmount(dai, AMOUNT_DAI_WEI)),
        daiWeth.getOutputAmount(new TokenAmount(weth, AMOUNT_ETH_WEI)),
      ]);
      const uniswapRates = {
        buy: parseFloat(
          AMOUNT_DAI_WEI / (uniswapResults[0][0].toExact() * 10 ** 18)
        ),
        sell: parseFloat(uniswapResults[1][0].toExact() / AMOUNT_ETH),
      };
      console.log('Uniswap ETH/DAI');
      console.log(uniswapRates);

      //evaluate arbitrage oppourtinity
      const gasPrice = await web3.eth.getGasPrice();
      //200000 is picked arbitrarily, have to be replaced by actual tx cost, with Web3 estimateGas()
      const txCost = 200000 * parseInt(gasPrice);

      const currentEthPrice = (uniswapRates.buy + uniswapRates.sell) / 2;
      const profit1 =
        (parseInt(AMOUNT_ETH_WEI) / 10 ** 18) *
          (uniswapRates.sell - kyberRates.buy) -
        (txCost / 10 ** 18) * currentEthPrice;
      const profit2 =
        (parseInt(AMOUNT_ETH_WEI) / 10 ** 18) *
          (kyberRates.sell - uniswapRates.buy) -
        (txCost / 10 ** 18) * currentEthPrice;

      if (profit1 > 0) {
        console.log('Arb opportunity found!');
        console.log(`Buy ETH on Kyber at ${kyberRates.buy} dai`);
        console.log(`Sell ETH on Uniswap at ${uniswapRates.sell} dai`);
        console.log(`Expected profit: ${profit1} dai`);
        //Execute arb Kyber <=> Uniswap
      } else if (profit2 > 0) {
        console.log('Arb opportunity found!');
        console.log(`Buy ETH from Uniswap at ${uniswapRates.buy} dai`);
        console.log(`Sell ETH from Kyber at ${kyberRates.sell} dai`);
        console.log(`Expected profit: ${profit2} dai`);
        //Execute arb Uniswap <=> Kyber
      }
    })
    .on('error', (error) => {
      console.log(error);
    });
};
init();
