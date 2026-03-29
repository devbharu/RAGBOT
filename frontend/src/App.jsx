import { useState } from 'react'
import Chatbot from './components/Chatbot'
import Header from './components/Header'



function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div className='bg-blue-200'>
        {/* <Header /> */}
        <Chatbot />

      </div>
    </>
  )
}

export default App
