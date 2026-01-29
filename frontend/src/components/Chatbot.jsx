import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, Image, FileText } from 'lucide-react';

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

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
        }
    }, [inputValue]);

    const handleSend = () => {
        if (inputValue.trim() === '') return;

        const userMessage = {
            id: messages.length + 1,
            type: 'user',
            content: inputValue,
            timestamp: new Date()
        };

        setMessages([...messages, userMessage]);
        setInputValue('');

        // Simulate bot response
        setIsTyping(true);
        setTimeout(() => {
            const botMessage = {
                id: messages.length + 2,
                type: 'bot',
                content: 'I understand your message. How else can I help you?',
                timestamp: new Date()
            };
            setMessages(prev => [...prev, botMessage]);
            setIsTyping(false);
        }, 1500);
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col h-screen bg-[#262624] text-white">
            {/* Messages Container */}
            <div className="flex-1 overflow-y-auto px-4 py-6">
                <div className="max-w-3xl mx-auto space-y-6">
                    {messages.map((message) => (
                        <div
                            key={message.id}
                            className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                            <div className={`flex gap-3 max-w-[80%] ${message.type === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                                {/* Avatar */}
                                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${message.type === 'user'
                                    ? 'bg-blue-600'
                                    : 'bg-green-600'
                                    }`}>
                                    {message.type === 'user' ? 'U' : 'AI'}
                                </div>

                                {/* Message Bubble */}
                                <div className={`rounded-2xl px-4 py-3 ${message.type === 'user'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-[#3a3a37] text-gray-100'
                                    }`}>
                                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                        {message.content}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Typing Indicator */}
                    {isTyping && (
                        <div className="flex justify-start">
                            <div className="flex gap-3 max-w-[80%]">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-sm font-semibold">
                                    AI
                                </div>
                                <div className="bg-[#3a3a37] rounded-2xl px-4 py-3">
                                    <div className="flex gap-1">
                                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input Container */}
            <div className="border-t border-[#3a3a37] bg-[#262624] px-4 py-4">
                <div className="max-w-3xl mx-auto">
                    <div className="bg-[#3a3a37] rounded-3xl flex items-end p-2 shadow-lg">
                        {/* Attachment Button */}
                        <button
                            className="flex-shrink-0 p-2 text-gray-400 hover:text-white hover:bg-[#4a4a47] rounded-full transition-all duration-200"
                            title="Attach files"
                        >
                            <Paperclip size={20} />
                        </button>

                        {/* Text Input */}
                        <textarea
                            ref={textareaRef}
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyPress={handleKeyPress}
                            placeholder="Message chatbot..."
                            rows={1}
                            className="flex-1 bg-transparent border-none outline-none resize-none px-3 py-2 text-sm text-white placeholder-gray-500 max-h-32 overflow-y-auto"
                            style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' }}
                        />

                        {/* Send Button */}
                        <button
                            onClick={handleSend}
                            disabled={inputValue.trim() === ''}
                            className={`flex-shrink-0 p-2 rounded-full transition-all duration-200 ${inputValue.trim() === ''
                                ? 'text-gray-500 cursor-not-allowed'
                                : 'text-white bg-blue-600 hover:bg-blue-700'
                                }`}
                        >
                            <Send size={18} />
                        </button>
                    </div>

                    {/* Footer Text */}
                    <p className="text-center text-xs text-gray-500 mt-3">
                        Chatbot can make mistakes. Check important info.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Chatbot;