import { useRef, useState, useEffect, useCallback } from "react";
import type { DatasetSparse } from "@/api";
import { CompactDatasetCard } from "./CompactDatasetCard";
import styles from "./DatasetGrid.module.css";

interface DatasetGridProps {
  datasets: DatasetSparse[];
  selectedDatasetId: string | null;
  onSelect: (id: string) => void;
  hasSelection: boolean;
}

export function DatasetGrid({ datasets, selectedDatasetId, onSelect, hasSelection }: DatasetGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll);
    const observer = new ResizeObserver(checkScroll);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      observer.disconnect();
    };
  }, [checkScroll, datasets.length, hasSelection]);

  const scroll = (direction: "left" | "right") => {
    scrollRef.current?.scrollBy({
      left: direction === "left" ? -300 : 300,
      behavior: "smooth",
    });
  };

  const scrollAreaClass = `${styles.scrollArea} ${hasSelection ? styles.scrollAreaRow : styles.scrollAreaGrid}`;

  return (
    <div className={styles.container}>
      {hasSelection && (
        <button
          className={`${styles.arrow} ${styles.arrowLeft}`}
          onClick={() => scroll("left")}
          disabled={!canScrollLeft}
          aria-label="Scroll left"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={styles.arrowIcon}>
            <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
          </svg>
        </button>
      )}

      <div ref={scrollRef} className={scrollAreaClass}>
        {datasets.map((ds) => (
          <CompactDatasetCard
            key={ds.id}
            dataset={ds}
            isSelected={ds.id === selectedDatasetId}
            onClick={() => onSelect(ds.id)}
          />
        ))}
      </div>

      {hasSelection && (
        <button
          className={`${styles.arrow} ${styles.arrowRight}`}
          onClick={() => scroll("right")}
          disabled={!canScrollRight}
          aria-label="Scroll right"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={styles.arrowIcon}>
            <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
          </svg>
        </button>
      )}
    </div>
  );
}
