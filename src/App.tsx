import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Layout from "@/components/Layout";
import Home from "@/pages/Home";
import Detect from "@/pages/Detect";
import Annotate from "@/pages/Annotate";
import Train from "@/pages/Train";
import Datasets from "@/pages/Datasets";
import Augment from "@/pages/Augment";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="detect" element={<Detect />} />
          <Route path="annotate" element={<Annotate />} />
          <Route path="train" element={<Train />} />
          <Route path="datasets" element={<Datasets />} />
          <Route path="augment" element={<Augment />} />
        </Route>
      </Routes>
    </Router>
  );
}
