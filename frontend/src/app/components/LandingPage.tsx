"use client";

import { Layers, Cpu, Zap, MessageCircle, BarChart3, ChevronRight, Check } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

export interface WorkflowProgress {
  hasAgents: boolean;
  hasBatches: boolean;
  hasReviewedSessions: boolean;
  hasFailureModes: boolean;
}

interface LandingPageProps {
  progress: WorkflowProgress;
  onSkipToAgents: () => void;
  onDismiss: () => void;
}

// ============================================================================
// Workflow Step Card
// ============================================================================

interface StepCardProps {
  stepNumber: number;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  isCompleted: boolean;
  isActive: boolean;
  delay: number;
}

function StepCard({ stepNumber, icon, title, subtitle, description, isCompleted, isActive, delay }: StepCardProps) {
  return (
    <div 
      className="group relative animate-fade-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Connector Line (except for first card) */}
      {stepNumber > 1 && (
        <div 
          className="absolute -left-8 top-1/2 w-8 h-0.5 hidden lg:block"
          style={{ backgroundColor: isCompleted ? '#10BFCC' : '#333333' }}
        />
      )}
      
      <div
        className={`relative overflow-hidden rounded-xl border p-6 transition-all duration-300 h-full ${
          isCompleted 
            ? 'border-teal/40 bg-teal/5' 
            : isActive 
              ? 'border-gold/40 bg-gold/5' 
              : 'border-moon-700 bg-moon-800/30'
        } ${isActive ? 'hover:border-gold/60 hover:bg-gold/10' : 'hover:border-moon-600 hover:bg-moon-800/50'}`}
      >
        {/* Step Number Badge */}
        <div 
          className={`absolute -top-1 -right-1 w-8 h-8 rounded-bl-xl flex items-center justify-center text-sm font-medium ${
            isCompleted 
              ? 'bg-teal text-moon-900' 
              : isActive 
                ? 'bg-gold text-moon-900' 
                : 'bg-moon-700 text-moon-450'
          }`}
        >
          {isCompleted ? <Check className="w-4 h-4" /> : stepNumber}
        </div>

        {/* Icon */}
        <div 
          className={`w-14 h-14 rounded-xl flex items-center justify-center mb-4 ${
            isCompleted 
              ? 'bg-teal/20' 
              : isActive 
                ? 'bg-gold/20' 
                : 'bg-moon-700/50'
          }`}
        >
          <div className={isCompleted ? 'text-teal' : isActive ? 'text-gold' : 'text-moon-450'}>
            {icon}
          </div>
        </div>

        {/* Content */}
        <h3 className="font-display text-lg text-moon-50 mb-1">{title}</h3>
        <p className="text-sm text-gold mb-3">{subtitle}</p>
        <p className="text-sm text-moon-450 leading-relaxed">{description}</p>

        {/* Active indicator */}
        {isActive && !isCompleted && (
          <div className="mt-4 flex items-center gap-2 text-gold text-sm">
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
            Start here
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Landing Page Component
// ============================================================================

export default function LandingPage({ progress, onSkipToAgents, onDismiss }: LandingPageProps) {
  const workflowSteps = [
    {
      icon: <Cpu className="w-7 h-7" />,
      title: "Connect Agent",
      subtitle: "Step 1",
      description: "Register your agent with an AG-UI endpoint. We'll extract capabilities, tools, and testing dimensions automatically.",
      isCompleted: progress.hasAgents,
    },
    {
      icon: <Zap className="w-7 h-7" />,
      title: "Generate Test Data",
      subtitle: "Step 2", 
      description: "Create synthetic queries across testing dimensions. Execute them against your agent to generate conversation traces.",
      isCompleted: progress.hasBatches,
    },
    {
      icon: <MessageCircle className="w-7 h-7" />,
      title: "Review Threads",
      subtitle: "Step 3",
      description: "Review agent responses, identify issues, and add notes. Each note captures an observation about agent behavior.",
      isCompleted: progress.hasReviewedSessions,
    },
    {
      icon: <BarChart3 className="w-7 h-7" />,
      title: "Categorize Failures",
      subtitle: "Step 4",
      description: "Build your failure mode taxonomy. AI helps cluster observations into categories, tracking saturation over time.",
      isCompleted: progress.hasFailureModes,
    },
  ];

  // Find the first incomplete step for highlighting
  const activeStepIndex = workflowSteps.findIndex(step => !step.isCompleted);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#171A1F' }}>
      {/* Header */}
      <header className="border-b" style={{ borderColor: '#252830' }}>
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#FCBC32' }}>
                <Layers className="w-6 h-6" style={{ color: '#171A1F' }} />
              </div>
              <div>
                <h1 className="font-display text-xl" style={{ color: '#FDFDFD' }}>
                  Error Analysis
                </h1>
                <p className="text-xs" style={{ color: '#8F949E' }}>Bottom-up failure mode discovery</p>
              </div>
            </div>
            
            <button 
              onClick={onDismiss}
              className="text-sm text-moon-450 hover:text-moon-50 transition-colors"
            >
              Skip to app →
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 py-12">
        <div className="max-w-6xl mx-auto px-6">
          {/* Hero Section */}
          <div className="text-center mb-12 animate-fade-in">
            <h2 className="font-display text-4xl md:text-5xl text-moon-50 mb-4">
              Discover Agent Failure Modes
            </h2>
            <p className="text-lg text-moon-450 max-w-2xl mx-auto leading-relaxed">
              A structured workflow to systematically identify, categorize, and track failure patterns in your AI agents.
            </p>
          </div>

          {/* Workflow Steps */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8 mb-12">
            {workflowSteps.map((step, index) => (
              <StepCard
                key={index}
                stepNumber={index + 1}
                icon={step.icon}
                title={step.title}
                subtitle={step.subtitle}
                description={step.description}
                isCompleted={step.isCompleted}
                isActive={index === activeStepIndex}
                delay={index * 80}
              />
            ))}
          </div>

          {/* CTA Section */}
          <div className="flex items-center justify-center animate-fade-in" style={{ animationDelay: '350ms' }}>
            <button
              onClick={onSkipToAgents}
              className="btn-primary px-8 py-3 text-base flex items-center gap-2 group"
            >
              Start
              <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>

          {/* Feature Highlights */}
          <div className="mt-16 pt-12 border-t border-moon-800">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                {
                  title: "AI-Assisted Categorization",
                  description: "LLM automatically clusters your observations into meaningful failure mode categories.",
                },
                {
                  title: "Saturation Tracking",
                  description: "Know when you've found most failure modes—stop when discovery plateaus.",
                },
                {
                  title: "Synthetic Data Generation", 
                  description: "Generate targeted test queries based on your agent's capabilities and edge cases.",
                },
              ].map((feature, i) => (
                <div 
                  key={i} 
                  className="text-center animate-fade-in"
                  style={{ animationDelay: `${500 + i * 80}ms` }}
                >
                  <h4 className="font-display text-base text-moon-50 mb-2">{feature.title}</h4>
                  <p className="text-sm text-moon-450 leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 border-t border-moon-800">
        <div className="max-w-6xl mx-auto px-6 text-center text-sm text-moon-450">
          Powered by Weights & Biases Weave
        </div>
      </footer>
    </div>
  );
}

