import { expect, test } from 'claude-code/testing'

import { cellText, cellsOf, columnsOf, fitCells } from './raster'

test('a Raster cell keeps one-column characters and draws the rest as a middle dot', () => {
  expect(cellText('Fix login ✓ ● │')).toBe('Fix login ✓ ● │')
  // accented and Cyrillic letters are one column wide: they stay
  expect(cellText('café Привет')).toBe('café Привет')
  // CJK is two columns wide, an emoji sequence one picture two columns wide: one dot each
  expect(cellText('登入')).toBe('··')
  expect(cellText('go 👨‍👩‍👧 now')).toBe('go · now')
  // a combining accent takes no cell of its own
  expect(cellText('é')).toBe('e')
  expect(cellsOf('登入 ok')).toBe(5)
})

test('plain Text counts a wide character as two columns', () => {
  expect(columnsOf('login')).toBe(5)
  expect(columnsOf('登入')).toBe(4)
  expect(columnsOf('👨‍👩‍👧')).toBe(2)
})

test('a title is cut to its cells and ends in an ellipsis', () => {
  expect(fitCells('short', 10)).toBe('short')
  expect(fitCells('a long title here', 8)).toBe('a long…')
})
