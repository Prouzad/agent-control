// Re-mounts on every navigation, so each page slides in
const Template = (props: { children: React.ReactNode }) => (
  <div className="page-enter">{props.children}</div>
)

export default Template
