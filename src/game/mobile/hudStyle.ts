/**
 * HUD layout for touch play (the engine container gets `.ih-touch`). The
 * default HUD puts health bottom-left and ammo bottom-right, exactly where
 * the thumbs and the on-screen buttons sit, so on touch everything moves to
 * the top edge or the bottom centre, shrinks for small landscape screens and
 * respects the notch (safe-area insets). Overrides need !important because
 * the HUD writes inline styles.
 */
export const TOUCH_HUD_STYLE = `
.ih-touch{--ih-k:.72;--ih-l:env(safe-area-inset-left,0px);--ih-r:env(safe-area-inset-right,0px);--ih-t:env(safe-area-inset-top,0px);--ih-b:env(safe-area-inset-bottom,0px)}
@media (min-height:560px){.ih-touch{--ih-k:.9}}
.ih-touch .ih-hud .ih-compass{top:calc(4px + var(--ih-t))!important;width:min(240px,38vw)!important;transform:translateX(-50%) scale(.9)!important}
.ih-touch .ih-hud .ih-compass-mark{top:calc(27px + var(--ih-t))!important}
.ih-touch .ih-hud .ih-fps{right:auto!important;left:50%!important;top:calc(50px + var(--ih-t))!important;transform:translateX(-50%)}
.ih-touch .ih-hud .ih-health{left:50%!important;bottom:calc(8px + var(--ih-b))!important;width:170px!important;transform:translateX(-50%) scale(var(--ih-k));transform-origin:bottom center}
.ih-touch .ih-hud .ih-weapon{right:calc(104px + var(--ih-r))!important;bottom:auto!important;top:calc(4px + var(--ih-t))!important;transform:scale(calc(var(--ih-k) * .9));transform-origin:top right}
.ih-touch .ih-hud .ih-feed{right:calc(12px + var(--ih-r))!important;top:calc(84px + var(--ih-t))!important;transform:scale(var(--ih-k));transform-origin:top right}
.ih-touch .ih-hud .ih-s-wave{left:calc(12px + var(--ih-l))!important;top:calc(8px + var(--ih-t))!important;transform:scale(var(--ih-k));transform-origin:top left}
.ih-touch .ih-hud .ih-s-money{left:calc(104px + var(--ih-l))!important;bottom:auto!important;top:calc(14px + var(--ih-t))!important;transform:scale(var(--ih-k));transform-origin:top left}
.ih-touch .ih-hud .ih-s-boss{top:calc(56px + var(--ih-t))!important}
.ih-touch .ih-hud .ih-s-prompt{top:calc(50% + 58px)!important}
`;
