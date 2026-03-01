import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/20/solid";
import { useCallback,useEffect, useRef, useState } from "react";

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

  const scroll = useCallback((direction: "left" | "right") => {
    scrollRef.current?.scrollBy({
      left: direction === "left" ? -300 : 300,
      behavior: "smooth",
    });
  }, []);

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
          <ChevronLeftIcon className={styles.arrowIcon} />
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
          <ChevronRightIcon className={styles.arrowIcon} />
        </button>
      )}
    </div>
  );
}
