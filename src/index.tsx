import React, {
  memo,
  ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  GestureResponderEvent,
  LayoutChangeEvent,
  LayoutRectangle,
  NativeScrollEvent,
  NativeScrollPoint,
  NativeSyntheticEvent,
  PanResponder,
  PanResponderGestureState,
  ScrollView,
  ScrollViewProps,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { IPoint } from './types';
import { getItemPosition, useValueChangeEffect } from './util';

const styles = StyleSheet.create({
  itemBox: {
    position: 'absolute',
  },
  itemTouch: {
    flex: 1,
  },
});

const defaultAnimationDuration = 150;

const defaultSelectedStyle: ViewStyle = {
  elevation: 10,
  shadowColor: '#000',
  shadowOpacity: 0.2,
  shadowRadius: 8,
  zIndex: 1000,
};

const defaultAnimationConfig: Omit<
  Animated.TimingAnimationConfig,
  'toValue'
> = {
  easing: Easing.ease,
  duration: defaultAnimationDuration,
  useNativeDriver: true,
};

const returnTrue = (): boolean => true;
const returnFalse = (): boolean => false;

interface IItemState {
  key: string;
  index: number;
  pos: IPoint;
  posAnimated: Animated.ValueXY;
  opacity: Animated.Value;
}

interface IState {
  animationConfig: Omit<Animated.TimingAnimationConfig, 'toValue'>;
  animationId: number | null;
  contentOffset?: NativeScrollPoint;
  animations: Animated.CompositeAnimation[];
  itemHeight: number;
  itemStateMap: Record<string, IItemState | undefined>;
  keys: string[];
  itemWidth: number;
  layout?: LayoutRectangle;
  moveY?: number; // The position for dragging
  numColumns: number;
  numRows: number;
  selectedKey: string | null;
  startPoint: IPoint | null; // Starting position when dragging
  startPointOffset: number; // Offset for the starting point for scrolling
  width: number;
}

export interface IGridViewProps<T> extends ScrollViewProps {
  activeOpacity?: number;
  animationConfig?: Omit<Animated.TimingAnimationConfig, 'toValue'>;
  data: T[];
  delayLongPress?: number;
  itemHeight?: number;
  itemWidth?: number;
  keyExtractor: (item: T) => string;
  numColumns?: number;
  onDragStart?: (key: string, index: number) => void;
  onPressItem?: (event: GestureResponderEvent, item: T, index: number) => void;
  onSort: (keys: string[]) => void;
  renderItem: (data: { item: T; key: string; index: number }) => ReactNode;
  selectedStyle?: ViewStyle;
  width?: number;
}

function GridViewToMemo<T>({
  activeOpacity = 0.5,
  animationConfig = defaultAnimationConfig,
  data,
  delayLongPress = 500,
  itemHeight: itemHeightProp,
  itemWidth: itemWidthProp,
  keyExtractor,
  numColumns = 1,
  onDragStart,
  onPressItem,
  onSort,
  renderItem,
  selectedStyle = defaultSelectedStyle,
  width: widthProp,
}: IGridViewProps<T>): JSX.Element {
  const scrollViewRef = useRef<ScrollView>(null);

  // state
  const windowWidth = useWindowDimensions().width;

  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const state = useRef<IState>({
    animationConfig,
    animationId: null,
    animations: [],
    itemHeight: 0,
    itemStateMap: {},
    keys: [],
    itemWidth: 0,
    numColumns,
    numRows: 0,
    selectedKey,
    startPoint: null,
    startPointOffset: 0,
    width: 0,
  }).current;

  state.animationConfig = animationConfig;
  state.numColumns = numColumns;
  state.numRows = Math.ceil(data.length / numColumns);
  state.width = widthProp || windowWidth;
  state.itemWidth = itemWidthProp || state.width / numColumns;
  state.itemHeight = itemHeightProp || state.itemWidth;
  state.selectedKey = selectedKey;

  // item state
  const curItemStateMap = useMemo(() => {
    const prevMap = state.itemStateMap;
    const map = {} as Record<string, IItemState | undefined>;

    let changed = false;
    const keys = data.map((item, index) => {
      const key = keyExtractor(item);
      const prevItemState = prevMap[key];
      // eslint-disable-next-line no-prototype-builtins
      if (prevMap.hasOwnProperty(key) && prevItemState?.index === index) {
        map[key] = prevMap[key];
      } else {
        changed = true;
        const pos = getItemPosition(index, state);
        map[key] = {
          ...prevItemState,
          key,
          index,
          pos,
          posAnimated: prevItemState?.posAnimated || new Animated.ValueXY(pos),
          opacity: prevItemState?.opacity || new Animated.Value(1),
        };
      }
      return key;
    });

    if (!changed) {
      changed = Object.keys(prevMap).length !== data.length;
    }

    if (changed) {
      state.keys = keys;
      state.itemStateMap = map;
      return map;
    }

    return prevMap;
  }, [data, keyExtractor, state]);

  useValueChangeEffect((newItemStateMap, prevItemStateMap) => {
    const anims = Object.keys(newItemStateMap)
      .map((key) => {
        const itemState = newItemStateMap[key];
        if (itemState && itemState !== prevItemStateMap?.[key]) {
          return Animated.timing(itemState.posAnimated, {
            ...state.animationConfig,
            toValue: itemState.pos,
          });
        }
        return null;
      })
      .filter((x) => x) as Animated.CompositeAnimation[];

    const anim = Animated.parallel(anims);
    state.animations.push(anim);
    anim.start(() => {
      state.animations = state.animations.filter((x) => x !== anim);
    });
  }, curItemStateMap);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      state.layout = event.nativeEvent.layout;
    },
    [state]
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      state.contentOffset = event.nativeEvent.contentOffset;
    },
    [state]
  );

  const handleLongPress = (key: string, index: number): void => {
    if (state.animations.length) return;

    state.startPoint = getItemPosition(index, state);
    state.startPointOffset = 0;
    setSelectedKey((state.selectedKey = key));

    if (onDragStart) onDragStart(key, index);
  };

  const reorder = useCallback(
    (x: number, y: number): void => {
      const {
        animations,
        itemHeight,
        itemStateMap,
        keys,
        itemWidth,
        numColumns: numCols,
        numRows,
        selectedKey: selKey,
      } = state;

      if (animations.length || !selKey) return;

      const itemState = itemStateMap[selKey];
      if (!itemState) return;

      let col = Math.floor((x + itemWidth / 2) / itemWidth);
      col = Math.max(0, Math.min(numCols, col));

      let row = Math.floor((y + itemHeight / 2) / itemHeight);
      row = Math.max(0, Math.min(numRows, row));

      const newIndex = Math.min(keys.length - 1, row * numCols + col);
      const prevIndex = itemState.index;

      if (newIndex === prevIndex) return;

      const newKeys = keys.slice();
      newKeys.splice(prevIndex, 1);
      newKeys.splice(newIndex, 0, selKey);
      state.keys = newKeys;

      const anims = newKeys
        .map((key, i) => {
          const iState = itemStateMap[key];
          if (iState) {
            iState.index = i;
            const pos = getItemPosition(i, state);
            iState.pos = pos;
            if (i !== newIndex) {
              return Animated.timing(iState.posAnimated, {
                ...state.animationConfig,
                toValue: pos,
              });
            }
          }
          return null;
        })
        .filter((a) => a) as Animated.CompositeAnimation[];

      const anim = Animated.parallel(anims);
      state.animations.push(anim);
      anim.start(() => {
        state.animations = state.animations.filter((a) => a !== anim);
      });
    },
    [state]
  );

  const handleMove = useCallback(
    (
      _event: GestureResponderEvent,
      { moveY, dx, dy }: PanResponderGestureState
    ): void => {
      const {
        itemStateMap,
        layout,
        selectedKey: selKey,
        startPoint,
        startPointOffset,
      } = state;

      if (!layout || !selKey || !startPoint) return;

      const itemState = itemStateMap[selKey];
      if (!itemState) return;

      state.moveY = moveY - layout.y;

      const x = startPoint.x + dx;
      const y = startPoint.y + dy + (startPointOffset || 0);

      itemState.posAnimated.setValue({ x, y });

      reorder(x, y);
    },
    [reorder, state]
  );

  const handleRelease = useCallback((): void => {
    const {
      startPoint,
      animationId,
      selectedKey: selKey,
      itemStateMap,
    } = state;
    if (!startPoint) return;

    state.startPoint = null;

    if (animationId) {
      cancelAnimationFrame(animationId);
      state.animationId = null;
    }

    if (!selKey) return;
    setSelectedKey((state.selectedKey = null));

    const itemState = itemStateMap[selKey];
    if (!itemState) return;

    const anim = Animated.timing(itemState.posAnimated, {
      ...state.animationConfig,
      toValue: itemState.pos,
      easing: Easing.out(Easing.quad),
    });

    state.animations.push(anim);
    anim.start(() => {
      state.animations = state.animations.filter((a) => a !== anim);
      onSort(state.keys);
    });
  }, [onSort, state]);

  // handleMoveShouldSetPanResponder

  const animate = useCallback((): void => {
    const {
      contentOffset,
      selectedKey: selKey,
      moveY,
      layout,
      itemStateMap,
    } = state;
    if (!selKey || moveY == null || !layout) return;

    const itemState = itemStateMap[selKey];
    if (!itemState) return;

    const itemHeightHalf = state.itemHeight / 2;

    let a = 0;
    if (moveY < itemHeightHalf) {
      a = Math.max(-itemHeightHalf, moveY - itemHeightHalf); // above
    } else if (moveY > layout.height - itemHeightHalf) {
      a = Math.min(itemHeightHalf, moveY - (layout.height - itemHeightHalf)); // below
    }

    if (a) {
      const offset = (a / itemHeightHalf) * 10;

      const contentOffsetY = contentOffset?.y || 0;
      const maxY = state.itemHeight * state.numRows - layout.height;
      const offY = Math.max(0, Math.min(maxY, contentOffsetY + offset));
      const diff = offY - contentOffsetY;
      if (Math.abs(diff) > 0.2) {
        // Set offset for the starting point of dragging
        state.startPointOffset += diff;
        // Move the dragging cell
        const { x: x0, y: y0 } = itemState.posAnimated;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, no-underscore-dangle
        const x = (x0 as any)._value as number;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, no-underscore-dangle, @typescript-eslint/restrict-plus-operands
        const y = ((y0 as any)._value + diff) as number;
        itemState.posAnimated.setValue({ x, y });
        reorder(x, y);
        scrollViewRef.current?.scrollTo({ y: offY, animated: false });
      }
    }

    state.animationId = requestAnimationFrame(animate);
  }, [reorder, state]);

  const handleMoveShouldSetPanResponder = useCallback(() => {
    if (!state.startPoint) return false;

    const shoudSet = state.selectedKey != null;
    if (shoudSet) animate();

    return shoudSet;
  }, [animate, state]);

  // pan responder

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: handleMoveShouldSetPanResponder,
        onMoveShouldSetPanResponderCapture: handleMoveShouldSetPanResponder,
        onPanResponderEnd: handleRelease,
        onPanResponderMove: handleMove,
        onPanResponderRelease: handleRelease,
        onPanResponderTerminationRequest: returnFalse,
        onShouldBlockNativeResponder: returnFalse,
        onStartShouldSetPanResponder: returnTrue,
        onStartShouldSetPanResponderCapture: returnFalse,
      }),
    [handleMove, handleMoveShouldSetPanResponder, handleRelease]
  );

  // -------------------------------------------------- 描画

  return (
    <ScrollView
      // {...rest}
      ref={scrollViewRef}
      onLayout={handleLayout}
      onScroll={handleScroll}
      scrollEnabled={!selectedKey}
      scrollEventThrottle={16}
    >
      <View
        style={{
          height: state.numRows * state.itemHeight,
        }}
      />
      {data.map((item, index) => {
        const key = keyExtractor(item);
        const itemState = curItemStateMap[key];
        if (!itemState) return null;

        return (
          <Animated.View
            {...panResponder.panHandlers}
            key={key}
            style={[
              styles.itemBox,
              {
                width: state.itemWidth,
                height: state.itemHeight,
                transform: itemState.posAnimated.getTranslateTransform(),
                opacity: itemState.opacity,
              },
              key === selectedKey && selectedStyle,
            ]}
          >
            <TouchableOpacity
              style={styles.itemTouch}
              activeOpacity={activeOpacity}
              delayLongPress={delayLongPress}
              onLongPress={() => handleLongPress(key, index)}
              onPress={
                onPressItem && ((event) => onPressItem(event, item, index))
              }
            >
              {renderItem({ item, key, index })}
            </TouchableOpacity>
          </Animated.View>
        );
      })}
    </ScrollView>
  );
}

export const GridView = memo(GridViewToMemo) as typeof GridViewToMemo;
