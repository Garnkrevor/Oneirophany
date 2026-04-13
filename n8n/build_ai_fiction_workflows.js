#!/usr/bin/env node
/**
 * n8n/build_ai_fiction_workflows.js
 *
 * Generates modular n8n workflow JSON files for the AI Fiction pipeline.
 * Outputs:
 * - n8n/ai_fiction_1_dossier.json
 * - n8n/ai_fiction_2_expansion.json
 * - n8n/ai_fiction_3_drafting.json
 * - n8n/ai_fiction_4_delopifier.json
 * - n8n/ai_fiction_MASTER.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function deterministicUuid(seed) {
  const h = crypto.createHash('sha256').update(seed).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32)
  ].join('-');
}

// ─── Node Generators ─────────────────────────────────────────────────────────

function geminiNode(name, position, promptExpression, model = 'gemini-1.5-pro') {
  return {
    id: deterministicUuid(name + '-node'),
    name: name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    parameters: {
      method: 'POST',
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key={{ $env.GEMINI_API_KEY }}`,
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: 'Content-Type', value: 'application/json' }]
      },
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/json',
      body: `={{ JSON.stringify({ contents: [{ parts: [{ text: ${promptExpression} }] }] }) }}`
    }
  };
}

function codeNode(name, position, jsCode) {
  return {
    id: deterministicUuid(name + '-node'),
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: { jsCode }
  };
}

function webhookNode(name, position, pathUrl) {
  return {
    id: deterministicUuid(name + '-node'),
    name,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 1.1,
    position,
    parameters: {
      path: pathUrl,
      responseMode: 'lastNode',
      responseData: 'allEntries',
      httpMethod: 'POST',
      options: {}
    },
    webhookId: deterministicUuid(name + '-webhook')
  };
}

function googleDriveDownload(name, position) {
  return {
    id: deterministicUuid(name + '-node'),
    name,
    type: 'n8n-nodes-base.googleDrive',
    typeVersion: 3,
    position,
    parameters: {
      operation: 'download',
      fileId: { __rl: true, value: '={{ $json.driveFileId || "SET_FILE_ID_HERE" }}', mode: "id" }
    }
  };
}

function googleDriveUpdate(name, position) {
  return {
    id: deterministicUuid(name + '-node'),
    name,
    type: 'n8n-nodes-base.googleDrive',
    typeVersion: 3,
    position,
    parameters: {
      operation: 'update',
      fileId: { __rl: true, value: '={{ $json.driveFileId || "SET_FILE_ID_HERE" }}', mode: "id" },
      fileContent: '={{ JSON.stringify($json.story_payload, null, 2) }}'
    }
  };
}

function ifNode(name, position, conditionLeft, conditionRight, operator = 'equals') {
  return {
    id: deterministicUuid(name + '-node'),
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position,
    parameters: {
      conditions: {
        options: {},
        conditions: [
          {
            id: deterministicUuid(name + '-cond'),
            leftValue: conditionLeft,
            rightValue: conditionRight,
            operator: { type: 'boolean', operation: operator }
          }
        ],
        combinator: 'and'
      }
    }
  };
}

function executeWorkflowNode(name, position, targetWorkflowId) {
  return {
    id: deterministicUuid(name + '-node'),
    name,
    type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1,
    position,
    parameters: {
      workflowId: targetWorkflowId
    }
  };
}

// ─── Workflows ───────────────────────────────────────────────────────────────

function buildWorkflow1Dossier() {
  const nodes = [
    webhookNode('Webhook Trig', [0, 300], 'ai-fiction-dossier'),
    googleDriveDownload('Load Payload from Drive', [200, 300]),
    codeNode('Extract Braindump', [400, 300], `
      // Read payload
      const payload = JSON.parse($input.first().json.data || "{}");
      return [{ json: { story_payload: payload } }];
    `),
    geminiNode('Generate 5 Pitches', [600, 300], '`Generate 5 distinct story pitches based on this braindump: ${JSON.stringify($json.story_payload.braindump)}`'),
    ifNode('Is Autonomous?', [800, 300], '={{ $json.story_payload.autonomous_mode }}', true),
    codeNode('Auto-Select Pitch', [1000, 200], `
      const payload = $input.first().json.story_payload;
      payload.selected_pitch = "Auto-selected pitch 1 (assuming parse)";
      return [{ json: { story_payload: payload } }];
    `),
    codeNode('Email & Wait', [1000, 400], `// Mock wait for HITL\nreturn $input.first();`),
    geminiNode('Generate Dossier', [1200, 300], '`Generate full story dossier from this pitch: ${JSON.stringify($json.story_payload.selected_pitch)}`'),
    geminiNode('Run Checks (Emotional, Name, Logic)', [1400, 300], '`Run checks and revise dossier: ${JSON.stringify($json.story_payload.dossier)}`'),
    googleDriveUpdate('Save Payload to Drive', [1600, 300])
  ];

  const connections = {
    'Webhook Trig': { main: [[{ node: 'Load Payload from Drive', type: 'main', index: 0 }]] },
    'Load Payload from Drive': { main: [[{ node: 'Extract Braindump', type: 'main', index: 0 }]] },
    'Extract Braindump': { main: [[{ node: 'Generate 5 Pitches', type: 'main', index: 0 }]] },
    'Generate 5 Pitches': { main: [[{ node: 'Is Autonomous?', type: 'main', index: 0 }]] },
    'Is Autonomous?': {
      main: [
        [{ node: 'Auto-Select Pitch', type: 'main', index: 0 }],
        [{ node: 'Email & Wait', type: 'main', index: 0 }]
      ]
    },
    'Auto-Select Pitch': { main: [[{ node: 'Generate Dossier', type: 'main', index: 0 }]] },
    'Email & Wait': { main: [[{ node: 'Generate Dossier', type: 'main', index: 0 }]] },
    'Generate Dossier': { main: [[{ node: 'Run Checks (Emotional, Name, Logic)', type: 'main', index: 0 }]] },
    'Run Checks (Emotional, Name, Logic)': { main: [[{ node: 'Save Payload to Drive', type: 'main', index: 0 }]] }
  };

  return { name: 'AI Fiction 1: Dossier', nodes, connections, id: 'aific-wf-1' };
}

function buildWorkflow2Expansion() {
  const nodes = [
    webhookNode('Webhook Trig', [0, 300], 'ai-fiction-expand'),
    googleDriveDownload('Load Payload from Drive', [200, 300]),
    geminiNode('Expand Characters (Sliders)', [400, 300], '`Expand characters dynamically: ${JSON.stringify($json.story_payload)}`'),
    geminiNode('Expand World Elements', [600, 300], '`Expand world elements: ${JSON.stringify($json.story_payload)}`'),
    googleDriveUpdate('Save Payload to Drive', [800, 300])
  ];
  const connections = {
    'Webhook Trig': { main: [[{ node: 'Load Payload from Drive', type: 'main', index: 0 }]] },
    'Load Payload from Drive': { main: [[{ node: 'Expand Characters (Sliders)', type: 'main', index: 0 }]] },
    'Expand Characters (Sliders)': { main: [[{ node: 'Expand World Elements', type: 'main', index: 0 }]] },
    'Expand World Elements': { main: [[{ node: 'Save Payload to Drive', type: 'main', index: 0 }]] }
  };
  return { name: 'AI Fiction 2: Expansion', nodes, connections, id: 'aific-wf-2' };
}

function buildWorkflow3Drafting() {
  const nodes = [
    webhookNode('Webhook Trig', [0, 300], 'ai-fiction-drafting'),
    googleDriveDownload('Load Payload from Drive', [200, 300]),
    geminiNode('Generate Outline', [400, 300], '`Generate Plot Outline: ${JSON.stringify($json.story_payload)}`'),
    ifNode('Is Autonomous?', [600, 300], '={{ $json.story_payload.autonomous_mode }}', true),
    codeNode('Email & Wait', [800, 400], `// Mock wait for HITL\nreturn $input.first();`),
    geminiNode('Generate Scene Briefs & Chapter', [1000, 300], '`Draft chapters from outline: ${JSON.stringify($json.story_payload)}`'),
    geminiNode('Run Chronology Checks', [1200, 300], '`Check chronology: ${JSON.stringify($json.story_payload)}`'),
    googleDriveUpdate('Save Payload to Drive', [1400, 300])
  ];
  const connections = {
    'Webhook Trig': { main: [[{ node: 'Load Payload from Drive', type: 'main', index: 0 }]] },
    'Load Payload from Drive': { main: [[{ node: 'Generate Outline', type: 'main', index: 0 }]] },
    'Generate Outline': { main: [[{ node: 'Is Autonomous?', type: 'main', index: 0 }]] },
    'Is Autonomous?': {
      main: [
        [{ node: 'Generate Scene Briefs & Chapter', type: 'main', index: 0 }],
        [{ node: 'Email & Wait', type: 'main', index: 0 }]
      ]
    },
    'Email & Wait': { main: [[{ node: 'Generate Scene Briefs & Chapter', type: 'main', index: 0 }]] },
    'Generate Scene Briefs & Chapter': { main: [[{ node: 'Run Chronology Checks', type: 'main', index: 0 }]] },
    'Run Chronology Checks': { main: [[{ node: 'Save Payload to Drive', type: 'main', index: 0 }]] }
  };
  return { name: 'AI Fiction 3: Drafting', nodes, connections, id: 'aific-wf-3' };
}

function buildWorkflow4Delopifier() {
  const nodes = [
    webhookNode('Webhook Trig', [0, 300], 'ai-fiction-delopifier'),
    googleDriveDownload('Load Payload from Drive', [200, 300]),
    geminiNode('Pacing Check', [400, 300], '`Review pacing: ${JSON.stringify($json.story_payload)}`'),
    geminiNode('Delopifier (Remove AI-isms)', [600, 300], '`Remove AI-isms: ${JSON.stringify($json.story_payload)}`'),
    googleDriveUpdate('Save Final Manuscript to Drive', [800, 300])
  ];
  const connections = {
    'Webhook Trig': { main: [[{ node: 'Load Payload from Drive', type: 'main', index: 0 }]] },
    'Load Payload from Drive': { main: [[{ node: 'Pacing Check', type: 'main', index: 0 }]] },
    'Pacing Check': { main: [[{ node: 'Delopifier (Remove AI-isms)', type: 'main', index: 0 }]] },
    'Delopifier (Remove AI-isms)': { main: [[{ node: 'Save Final Manuscript to Drive', type: 'main', index: 0 }]] }
  };
  return { name: 'AI Fiction 4: Delopifier', nodes, connections, id: 'aific-wf-4' };
}

function buildMasterWorkflow() {
  const nodes = [
    webhookNode('Master Trig', [0, 300], 'ai-fiction-master'),
    executeWorkflowNode('Run Workflow 1 (Dossier)', [200, 300], 'aific-wf-1'),
    executeWorkflowNode('Run Workflow 2 (Expansion)', [400, 300], 'aific-wf-2'),
    executeWorkflowNode('Run Workflow 3 (Drafting)', [600, 300], 'aific-wf-3'),
    executeWorkflowNode('Run Workflow 4 (Delopifier)', [800, 300], 'aific-wf-4')
  ];
  const connections = {
    'Master Trig': { main: [[{ node: 'Run Workflow 1 (Dossier)', type: 'main', index: 0 }]] },
    'Run Workflow 1 (Dossier)': { main: [[{ node: 'Run Workflow 2 (Expansion)', type: 'main', index: 0 }]] },
    'Run Workflow 2 (Expansion)': { main: [[{ node: 'Run Workflow 3 (Drafting)', type: 'main', index: 0 }]] },
    'Run Workflow 3 (Drafting)': { main: [[{ node: 'Run Workflow 4 (Delopifier)', type: 'main', index: 0 }]] }
  };
  return { name: 'AI Fiction MASTER', nodes, connections, id: 'aific-wf-master' };
}

// ─── Execute ─────────────────────────────────────────────────────────────────

const workflows = [
  { p: 'ai_fiction_1_dossier.json', fn: buildWorkflow1Dossier },
  { p: 'ai_fiction_2_expansion.json', fn: buildWorkflow2Expansion },
  { p: 'ai_fiction_3_drafting.json', fn: buildWorkflow3Drafting },
  { p: 'ai_fiction_4_delopifier.json', fn: buildWorkflow4Delopifier },
  { p: 'ai_fiction_MASTER.json', fn: buildMasterWorkflow }
];

workflows.forEach(wf => {
  const data = wf.fn();
  const output = {
    name: data.name,
    nodes: data.nodes,
    connections: data.connections,
    id: data.id,
    active: false,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
    meta: { instanceId: 'ai-fiction' },
    tags: [{ name: 'ai-fiction' }]
  };
  
  const destPath = path.join(__dirname, wf.p);
  fs.writeFileSync(destPath, JSON.stringify(output, null, 2));
  console.log('Generated: ' + destPath);
});
