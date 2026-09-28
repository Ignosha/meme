# Powerball Pattern Lab

A static web page that downloads every Powerball draw in the free
[NY Open Data feed](https://data.ny.gov/Government-Finance/Lottery-Powerball-Winning-Numbers-Beginning-2010/d6yy-54nr)
(no API key needed; the feed runs from 2010 to the latest draw). It tests the draws for patterns and checks whether any
"prediction" strategy beats chance.

The page uses live data only. If the feed can't be reached, it shows an error, never sample numbers.

## Run it

Open `index.html` in a browser, or serve the folder (`python3 -m http.server`) and visit it.

## What it tests (current 5/69 + 1/26 game, from 7 Oct 2015)

| Test | Question |
|---|---|
| Chi-square, white balls and Powerball | Are some numbers drawn more often? |
| Sum mean + shape vs the exact distribution | Do sums look like a fair draw? |
| Odd/even, low/high vs hypergeometric | Are the splits balanced as chance predicts? |
| Repeats + autocorrelation (lags 1–20) | Does a draw "remember" the previous one? |
| Walk-forward backtest (hot, cold, overdue, repeat) | Does any strategy match more balls than random? |

The page applies a Bonferroni correction across all tests.

## About "predicting" the next draw

Powerball comes from physical ball machines, not an algorithm. No formula exists to solve, and every
ticket has the same 1 in 292,201,338 jackpot odds. The page gives the next draw date and
cryptographically random tickets. It offers "less-popular" picks that avoid commonly played
combinations: same odds of winning, but lower odds of splitting a jackpot.

## Tests

```
node --test tests/*.test.js
```
