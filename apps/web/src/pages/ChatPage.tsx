import ChatContainer from '../components/chat/ChatContainer';
import SessionSelector from '../components/chat/SessionSelector';
import MessageList from '../components/chat/MessageList';
import PromptInput from '../components/chat/PromptInput';
import ConnectionStatus from '../components/chat/ConnectionStatus';

function ChatPage() {
  return (
    <ChatContainer>
      <SessionSelector />
      <ConnectionStatus />
      <MessageList />
      <PromptInput />
    </ChatContainer>
  );
}

export default ChatPage;
