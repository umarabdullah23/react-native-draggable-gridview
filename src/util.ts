import { useEffect, useRef } from 'react';
import { IPoint } from './types';

export const getItemPosition = (
  i: number,
  {
    numColumns,
    itemWidth,
    itemHeight,
  }: {
    numColumns: number;
    itemWidth: number;
    itemHeight: number;
  }
): IPoint => ({
  x: (i % numColumns) * itemWidth,
  y: Math.floor(i / numColumns) * itemHeight,
});

export type ValueChangeEffectCallback<T> = (
  value: T,
  prevValue: T | undefined
) => void | (() => void);

export const useValueChangeEffect = <T>(
  fn: ValueChangeEffectCallback<T>,
  value: T
): T | undefined => {
  const valueRef = useRef<T>();

  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const prevValue = valueRef.current;
    valueRef.current = value;
    if (prevValue !== value) {
      return fnRef.current(value, prevValue);
    }
  }, [value]);

  return valueRef.current;
};
