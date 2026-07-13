import * as Haptics from 'expo-haptics';

/** Light impact — stepper buttons, opening menus (~10 ms) */
export const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

/** Medium impact — scan success, add item, apply override (~50 ms) */
export const success = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

/** Multiple pulses — SKU Not Found, clear cart */
export const error = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

/** Triple pulse — successful transaction */
export const txComplete = async () => {
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  await new Promise((r) => setTimeout(r, 100));
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  await new Promise((r) => setTimeout(r, 100));
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
};
