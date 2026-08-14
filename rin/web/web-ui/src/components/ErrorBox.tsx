export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="error-box">
      <span className="error-kind">error</span>
      <span className="error-msg">{message}</span>
    </div>
  )
}
