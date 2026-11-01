export const register = async () => {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return
  const { startIndexLoop } = await import('./server/indexer')
  startIndexLoop()
  // A second server for UI checks must not run agents next to the real one
  if (process.env['AGENT_CONTROL_UI_ONLY'] === '1') return
  const { startPipelines } = await import('./server/pipelines')
  startPipelines()
  const { startReportUpdates } = await import('./server/report')
  startReportUpdates()
  const { startDispatch } = await import('./server/dispatch')
  startDispatch()
  const { startRunner } = await import('./server/runner')
  startRunner()
}
