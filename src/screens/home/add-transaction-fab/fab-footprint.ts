// The "+" button's side, as a spacing step (56 pt).
export const FAB_SIZE_STEP = 14;

// The standing gap, as a spacing step (16 pt): the button's lift above the Home list's bottom
// clearance, and the gap kept between the button's top edge and the last row at full scroll.
export const FAB_GAP_STEP = 4;

// The button plus the gap above it (72 pt), as a spacing step: how far above the button's own
// bottom edge the Home list's last row must end. The list pads its end by this on top of the
// button's bottom edge, so the button and the list cannot drift apart.
export const FAB_FOOTPRINT_STEP = FAB_SIZE_STEP + FAB_GAP_STEP;
