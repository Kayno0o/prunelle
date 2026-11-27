// The line under the masthead's rule, as a book prints its part on the left page and its chapter on the right.
export function RunningHead({ left, right }: { left: string, right: string }) {
  return (
    <div class="running-head">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  )
}
