// prunelle's mark: an almond eye in the accent colour with a slit pupil, drawn in CSS so it follows the theme.
export function Mark({ size }: { size?: 'large' | undefined }) {
  return <span class="mark" data-size={size} aria-hidden="true"><i /></span>
}
