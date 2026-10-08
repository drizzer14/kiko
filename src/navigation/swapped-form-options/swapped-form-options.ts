import type { TFunction } from 'i18next';

// A route swapped in from the other form carries a `draft`.
const carriesDraft = (params: object | undefined): boolean =>
  params !== undefined && 'draft' in params && params.draft !== undefined;

const swapAnimation = (params: object | undefined): 'none' | 'default' =>
  carriesDraft(params) ? 'none' : 'default';

// A swapped-in form mounts with `animation: 'none'` so the swap is instant.
// native-stack pops a screen with the animation it carries at that moment, so
// the 'none' would also make Back from it instant. Once the form has appeared,
// which the native stack reports with `transitionEnd` whatever the animation
// was, its animation goes back to the default (every later `transitionEnd`
// sets it again, which changes nothing). A layout effect on mount is too
// early: it can reach the native screen in the same mount batch and animate
// the swap.
export const restoreDefaultAnimationOfSwappedForm = ({
  navigation,
  route,
}: {
  navigation: { setOptions: (options: { animation: 'default' }) => void };
  route: { params?: object };
}) => ({
  transitionEnd: () => {
    if (carriesDraft(route.params)) {
      navigation.setOptions({ animation: 'default' });
    }
  },
});

// The account form and the implicit holding form replace each other when the
// kind changes, and a `draft` marks that swap: it has no animation, so it reads
// as one form whose fields change rather than a screen transition. Every stack
// that registers the two forms takes their options from here.
export const accountFormOptions = (t: TFunction, route: { params: object | undefined }) => ({
  title: t('forms.account.addTitle'),
  animation: swapAnimation(route.params),
});

export const holdingFormOptions = (t: TFunction, route: { params: object }) => ({
  title: 'implicitKind' in route.params ? t('forms.account.addTitle') : t('forms.holding.addTitle'),
  animation: swapAnimation(route.params),
});
