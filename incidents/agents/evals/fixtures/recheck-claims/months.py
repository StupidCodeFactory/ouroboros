def months_between(start, end):
    years = end // 100 - start // 100
    return years * 12 + (end % 100 - start % 100)
