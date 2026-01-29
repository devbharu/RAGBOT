import { useState } from 'react'
import Chatbot from './components/Chatbot'



function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div className='bg-blue-200'>

        <Chatbot />

      </div>
    </>
  )
}

export default App
