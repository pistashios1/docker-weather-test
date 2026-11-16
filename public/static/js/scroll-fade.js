// Edge fade for a horizontally scrolling strip: a side fades out only while
// there is more content to scroll to on that side. The fade itself is CSS (a
// mask on the strip); this module only reports which sides need it, as
// data-fade-start / data-fade-end attributes.

// Sub-pixel scroll positions (zoomed pages, fractional widths) must not leave a
// fade stuck on at the very end of the strip.
const TOLERANCE_PX = 1;

// `width` is the strip's full visible width (offsetWidth), not clientWidth: with
// `scrollbar-gutter: stable` the reserved gutter is outside clientWidth, yet the
// strip can scroll only to scrollWidth - offsetWidth. Using clientWidth left the
// end fade stuck on by the width of the gutter (15px on desktop browsers).
export const fadeState = ({ scrollLeft, width, scrollWidth }) => {
  const offset = Math.abs(scrollLeft);
  return {
    start: offset > TOLERANCE_PX,
    end: offset + width < scrollWidth - TOLERANCE_PX,
  };
};

export const watchScrollFade = (element) => {
  let frame = 0;

  const update = () => {
    frame = 0;
    const state = fadeState({
      scrollLeft: element.scrollLeft,
      width: element.offsetWidth,
      scrollWidth: element.scrollWidth,
    });
    element.dataset.fadeStart = String(state.start);
    element.dataset.fadeEnd = String(state.end);
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };

  element.addEventListener("scroll", schedule, { passive: true });

  // The strip's size changes with the window, and its content is replaced
  // whenever new weather loads.
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  resizeObserver?.observe(element);
  const mutationObserver = new MutationObserver(schedule);
  mutationObserver.observe(element, { childList: true });

  update();

  return {
    update,
    disconnect() {
      element.removeEventListener("scroll", schedule);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      if (frame) cancelAnimationFrame(frame);
    },
  };
};
