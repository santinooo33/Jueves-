import { test } from 'node:test';
import assert from 'node:assert/strict';

import { calcKey, calcPreview, CALC_INITIAL } from '../js/apps/calculadora.js';
import { typeKey, isUpper, NOTES_INITIAL } from '../js/apps/notas.js';
import { formatStopwatch } from '../js/apps/reloj.js';

// Pulsa una secuencia de teclas de la calculadora ("7×8=" o ['1', '0', 'back']).
const calc = (keys, state = { ...CALC_INITIAL }) => {
  for (const k of Array.isArray(keys) ? keys : [...keys]) state = calcKey(state, k);
  return state;
};
const shown = (state) => state.tokens.join(' ');

test('calculadora: operaciones básicas', () => {
  assert.equal(shown(calc('7×8=')), '56');
  assert.equal(shown(calc('5−8=')), '-3');
  assert.equal(shown(calc('9÷4=')), '2.25');
  assert.equal(shown(calc('0.1+0.2=')), '0.3', 'sin errores de coma flotante');
});

test('calculadora: × y ÷ van antes que + y −', () => {
  assert.equal(shown(calc('2+3×4=')), '14');
  assert.equal(shown(calc('10−6÷2=')), '7');
});

test('calculadora: dividir por cero da Error y C reinicia', () => {
  const s = calc('1÷0=');
  assert.equal(shown(s), 'Error');
  assert.equal(shown(calc('C', s)), '');
});

test('calculadora: vista previa, cambiar de operador y seguir tras "="', () => {
  const s = calc('12+3');
  assert.equal(calcPreview(s), '15');
  assert.equal(shown(calc('+×', calc('5'))), '5 ×', 'el segundo operador reemplaza al primero');
  assert.equal(shown(calc('+1=', calc('2+2='))), '5', 'sigue operando con el resultado');
  assert.equal(shown(calc('3', calc('2+2='))), '3', 'un número nuevo empieza otra cuenta');
});

test('calculadora: ⌫, ± y %', () => {
  assert.equal(shown(calc(['1', '2', '3', 'back'])), '12');
  assert.equal(shown(calc(['5', 'sign'])), '-5');
  assert.equal(shown(calc(['5', 'sign', 'sign'])), '5');
  assert.equal(shown(calc(['5', '0', 'percent'])), '0.5');
  assert.equal(shown(calc(['.', '5'])), '0.5');
  assert.equal(shown(calc(['1', '.', '.', '5'])), '1.5', 'un solo punto decimal');
});

// Teclea una secuencia en Notas.
const type = (keys, state = { ...NOTES_INITIAL }) => {
  for (const k of keys) state = typeKey(state, k);
  return state;
};

test('notas: mayúscula automática al empezar y después de un punto', () => {
  const s = type(['h', 'o', 'l', 'a', '.', 'space', 'c', 'h', 'a', 'o']);
  assert.equal(s.text, 'Hola. Chao');
});

test('notas: tilde y ñ', () => {
  const s = type(['m', 'a', 'accent', 'n', 'accent', 'a', 'space', 'n', 'i', 'ñ', 'o']);
  assert.equal(s.text, 'Maná niño', 'la tilde sobre una consonante se descarta');
});

test('notas: shift alterna la próxima letra y ⌫ borra', () => {
  assert.equal(type(['shift', 'h', 'o']).text, 'ho', 'shift al inicio la pasa a minúscula');
  assert.equal(type(['h', 'shift', 'o', 'l']).text, 'HOl', 'shift en medio: una sola mayúscula');
  assert.equal(type(['h', 'o', 'l', 'a', 'back', 'back']).text, 'Ho');
  assert.equal(type(['accent', 'back', 'e']).text, 'E', '⌫ cancela la tilde pendiente');
  assert.equal(isUpper(type(['h', 'o', 'enter'])), true, 'mayúscula tras salto de línea');
});

test('reloj: formato del cronómetro', () => {
  assert.equal(formatStopwatch(0), '00:00.00');
  assert.equal(formatStopwatch(61234), '01:01.23');
  assert.equal(formatStopwatch(3723450), '1:02:03.45');
});
