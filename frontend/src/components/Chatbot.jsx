import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip } from 'lucide-react';
import axios from 'axios';

const Chatbot = () => {
    const [messages, setMessages] = useState([
        {
            id: 1,
            type: 'bot',
            content: 'Hello! How can I assist you today?',
            timestamp: new Date()
        }
    ]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);

    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);

    // Auto scroll to bottom when messages update
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Auto resize textarea based on content
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [inputValue]);

    // Streaming text effect for bot responses
    const streamText = async (text, messageId) => {
        const tokens = text.split(' ');

        for (let i = 0; i < tokens.length; i++) {
            await new Promise(resolve => setTimeout(resolve, 35));

            setMessages(prev =>
                prev.map(msg =>
                    msg.id === messageId
                        ? { ...msg, content: msg.content + tokens[i] + ' ' }
                        : msg
                )
            );
        }
    };

    // Handle sending messages
    const handleSend = async () => {
        if (!inputValue.trim()) return;

        const userMsg = {
            id: Date.now(),
            type: 'user',
            content: inputValue,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMsg]);
        setInputValue('');
        setIsTyping(true);

        try {
            const res = await axios.post('http://127.0.0.1:8080/generate', {
                prompt: userMsg.content,
                temperature: 0.4,
                max_output_tokens: 1024,
                top_p: 0.9
            });

            const botId = Date.now() + 1;

            // Add empty bot message placeholder
            setMessages(prev => [
                ...prev,
                {
                    id: botId,
                    type: 'bot',
                    content: '',
                    timestamp: new Date()
                }
            ]);

            // Stream the response
            await streamText(res.data.response || "I don't know.", botId);

        } catch (error) {
            console.error('Error fetching bot response:', error);

            setMessages(prev => [
                ...prev,
                {
                    id: Date.now() + 2,
                    type: 'bot',
                    content: '⚠️ Error: Unable to fetch response from server.',
                    timestamp: new Date()
                }
            ]);
        } finally {
            setIsTyping(false);
        }
    };

    // Handle Enter key press
    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col h-screen bg-[#212121] text-white">
            {/* Messages Container */}
            <div className="flex-1 overflow-y-auto px-2 sm:px-4 py-4 sm:py-6">
                <div className="max-w-3xl mx-auto space-y-4 sm:space-y-6">
                    {messages.map(msg => (
                        <div
                            key={msg.id}
                            className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                            <div className={`flex gap-2 sm:gap-3 max-w-[90%] sm:max-w-[80%] ${msg.type === 'user' ? 'flex-row-reverse' : ''}`}>
                                {/* Avatar */}
                                <div
                                    className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold flex-shrink-0
                    ${msg.type === 'user' ? 'bg-blue-600' : 'bg-green-600'}`}
                                >
                                    {msg.type === 'user' ? 'U' : 'AI'}
                                </div>

                                {/* Message Bubble */}
                                <div
                                    className={`px-3 py-2 sm:px-4 sm:py-3 rounded-2xl text-sm sm:text-base leading-relaxed whitespace-pre-wrap
                    ${msg.type === 'user' ? 'bg-blue-600' : 'bg-[#2f2f2f]'}`}
                                >
                                    {msg.content}
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Typing Indicator */}
                    {isTyping && (
                        <div className="flex justify-start">
                            <div className="flex gap-2 sm:gap-3">
                                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-green-600 flex items-center justify-center text-xs sm:text-sm font-bold">
                                    AI
                                </div>
                                <div className="bg-[#2f2f2f] px-3 py-2 sm:px-4 sm:py-3 rounded-2xl flex gap-1">
                                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                </div>
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input Area */}
            <div className="border-t border-[#2f2f2f] p-2 sm:p-4">
                <div className="max-w-3xl mx-auto flex items-center gap-1 sm:gap-2 bg-[#2f2f2f] rounded-3xl p-1.5 sm:p-2">
                    {/* Attachment Button */}
                    <button
                        className="p-1.5 sm:p-2 text-gray-400 hover:text-white transition-colors flex-shrink-0"
                        aria-label="Attach file"
                    >
                        <Paperclip size={16} className="sm:w-[18px] sm:h-[18px]" />
                    </button>

                    {/* Input Textarea */}
                    <textarea
                        ref={textareaRef}
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Message AI..."
                        rows={1}
                        className="flex-1 bg-transparent resize-none outline-none text-sm sm:text-base text-white my-1 px-2   max-h-40"
                    />

                    {/* Send Button */}
                    <button
                        onClick={handleSend}
                        disabled={!inputValue.trim()}
                        className={`p-1.5 sm:p-2 rounded-full transition-colors flex-shrink-0 ${inputValue.trim()
                            ? 'bg-blue-600 hover:bg-blue-700'
                            : 'bg-gray-600 cursor-not-allowed'
                            }`}
                        aria-label="Send message"
                    >
                        <Send size={16} className="sm:w-[18px] sm:h-[18px]" />
                    </button>
                </div>

                {/* Footer Note */}
                <p className="text-xs text-gray-500 text-center mt-2">
                    AI responses are based only on your uploaded textbook.
                </p>
            </div>
        </div>
    );
};

export default Chatbot;