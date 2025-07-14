// Agent system exports and initialization
export { BaseAgent, agentRegistry } from './base';
export { OrchestratorAgent } from './orchestrator';
export { WriterAgent } from './writer';
export { CriticAgent } from './critic';
export { RouterAgent } from './router';
export { AnswerAgent } from './answer';

// Agent types
export type { AgentConfig, AgentMessage, AgentContext } from './base';
export type { DocumentGenerationTask } from './orchestrator';
export type { DocumentationInput, Documentation } from './writer';
export type { ReviewInput, ReviewFeedback } from './critic';
export type { QueryClassification, RouterInput } from './router';
export type { QuestionInput, AnswerResponse } from './answer';

// Initialize all agents
export async function initializeAgents() {
  const { agentRegistry } = await import('./base');
  const { OrchestratorAgent } = await import('./orchestrator');
  const { WriterAgent } = await import('./writer');
  const { CriticAgent } = await import('./critic');
  const { RouterAgent } = await import('./router');
  const { AnswerAgent } = await import('./answer');

  // Create agent instances
  const orchestrator = new OrchestratorAgent();
  const writer = new WriterAgent();
  const critic = new CriticAgent();
  const router = new RouterAgent();
  const answer = new AnswerAgent();

  // Register agents
  agentRegistry.register(orchestrator);
  agentRegistry.register(writer);
  agentRegistry.register(critic);
  agentRegistry.register(router);
  agentRegistry.register(answer);

  return {
    orchestrator,
    writer,
    critic,
    router,
    answer,
    registry: agentRegistry
  };
}

// Get agent by name
export async function getAgent(name: string) {
  const { agentRegistry } = await import('./base');
  return agentRegistry.get(name);
}

// Get all agents
export async function getAllAgents() {
  const { agentRegistry } = await import('./base');
  return agentRegistry.getAgents();
}

// Get agent statuses
export async function getAgentStatuses() {
  const { agentRegistry } = await import('./base');
  return agentRegistry.getStatuses();
}