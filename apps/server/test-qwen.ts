import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QwenAuth } from './src/llm/qwen-auth';

async function test() {
  console.log('Testing Qwen API...');
  
  const qwenAuth = new QwenAuth();
  const token = await qwenAuth.getToken();
  
  if (!token) {
    console.error('No token available');
    return;
  }
  
  console.log('Token obtained, creating model...');
  
  const openai = createOpenAI({
    apiKey: token,
    baseURL: 'https://portal.qwen.ai/v1',
  });
  
  const model = openai('coder-model');
  
  console.log('Calling Qwen API...');
  
  try {
    const result = await generateText({
      model,
      messages: [{ role: 'user', content: 'Say hello in 5 words' }],
      temperature: 0.7,
      maxTokens: 50,
    });
    
    console.log('Success!');
    console.log('Response:', result.text);
    console.log('Usage:', result.usage);
  } catch (error: any) {
    console.error('Error:', error.message);
    console.error('Cause:', error.cause);
    console.error('Stack:', error.stack);
  }
}

test();
